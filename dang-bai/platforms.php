<?php
// Module "Đăng bài MXH" – kết nối từng nền tảng (Facebook, Instagram, YouTube, TikTok)
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

function fb_ver(): string { return (string)cfg('fb_ver', 'v24.0'); }

/** Gọi Graph API của Meta, ném lỗi nếu có. */
function graph(string $method, string $path, array $params, string $host = 'graph.facebook.com'): array
{
    $url = "https://$host/" . fb_ver() . '/' . ltrim($path, '/');
    $r = $method === 'GET'
        ? http('GET', $url . '?' . http_build_query($params))
        : http('POST', $url, ['form' => $params, 'timeout' => 300]);
    $j = $r['json'];
    if (!is_array($j)) throw new RuntimeException("Meta trả về dữ liệu lạ (HTTP {$r['code']}).");
    if (isset($j['error'])) {
        $e = $j['error'];
        $hint = (int)($e['code'] ?? 0) === 190 ? ' – quyền truy cập hết hạn, hãy vào "Kết nối tài khoản" để kết nối lại Facebook.' : '';
        throw new RuntimeException('Meta: ' . ($e['error_user_msg'] ?? $e['message'] ?? 'lỗi không rõ') . (isset($e['code']) ? " (mã {$e['code']})" : '') . $hint);
    }
    return $j;
}

/* ---------- Token Google / TikTok (tự làm mới) ---------- */

function yt_token(): string
{
    $yt = cfg('yt');
    if (!$yt) throw new RuntimeException('Chưa kết nối kênh YouTube.');
    if (($yt['expires'] ?? 0) > time() + 120) return $yt['access'];
    $r = http('POST', 'https://oauth2.googleapis.com/token', ['form' => [
        'client_id' => cfg('google_client_id'), 'client_secret' => cfg('google_client_secret'),
        'refresh_token' => $yt['refresh'], 'grant_type' => 'refresh_token',
    ]]);
    $j = $r['json'] ?? [];
    if (empty($j['access_token'])) {
        throw new RuntimeException('Không làm mới được quyền YouTube (' . ($j['error_description'] ?? $j['error'] ?? 'HTTP ' . $r['code']) . '). Hãy kết nối lại YouTube.');
    }
    $yt['access'] = $j['access_token'];
    $yt['expires'] = time() + (int)($j['expires_in'] ?? 3600);
    if (!empty($j['refresh_token'])) $yt['refresh'] = $j['refresh_token'];
    cfg_set('yt', $yt);
    return $yt['access'];
}

function tt_token(): string
{
    $tt = cfg('tt');
    if (!$tt) throw new RuntimeException('Chưa kết nối tài khoản TikTok.');
    if (($tt['expires'] ?? 0) > time() + 300) return $tt['access'];
    $r = http('POST', 'https://open.tiktokapis.com/v2/oauth/token/', ['form' => [
        'client_key' => cfg('tiktok_client_key'), 'client_secret' => cfg('tiktok_client_secret'),
        'grant_type' => 'refresh_token', 'refresh_token' => $tt['refresh'],
    ]]);
    $j = $r['json'] ?? [];
    if (empty($j['access_token'])) {
        throw new RuntimeException('Không làm mới được quyền TikTok (' . ($j['error_description'] ?? $j['error'] ?? 'HTTP ' . $r['code']) . '). Hãy kết nối lại TikTok.');
    }
    $tt['access'] = $j['access_token'];
    $tt['expires'] = time() + (int)($j['expires_in'] ?? 86400);
    if (!empty($j['refresh_token'])) $tt['refresh'] = $j['refresh_token'];
    cfg_set('tt', $tt);
    return $tt['access'];
}

function tiktok_api(string $path, $json): array
{
    $r = http('POST', 'https://open.tiktokapis.com/v2/' . ltrim($path, '/'), [
        'headers' => ['Authorization: Bearer ' . tt_token()], 'json' => $json,
    ]);
    $j = $r['json'] ?? [];
    $code = $j['error']['code'] ?? '';
    if ($code !== 'ok') {
        throw new RuntimeException('TikTok: ' . ($j['error']['message'] ?? 'lỗi không rõ') . ($code ? " ($code)" : " (HTTP {$r['code']})"));
    }
    return $j['data'] ?? [];
}

/* ---------- Đăng một bài lên một nền tảng ----------
   Trả về ['status' => done|processing|failed, 'remote', 'url', 'error', 'state' => [...]]
   "processing" nghĩa là nền tảng đang xử lý video, lần chạy sau (1 phút) sẽ kiểm tra tiếp. */

function publish_step(array $post, array $res): array
{
    $state = json_decode($res['state'] ?: '{}', true) ?: [];
    if (cfg('dry_run', false)) {
        return ['status' => 'done', 'remote' => 'chay-thu', 'url' => '', 'error' => '', 'state' => ['dry' => true]];
    }
    switch ($res['platform']) {
        case 'facebook': return pub_facebook($post);
        case 'instagram': return pub_instagram($post, $state);
        case 'youtube': return pub_youtube($post);
        case 'tiktok': return pub_tiktok($post, $state);
    }
    throw new RuntimeException('Nền tảng không hỗ trợ.');
}

function media_path(array $post): string
{
    $f = MEDIA_DIR . '/' . $post['media'];
    if ($post['media'] === '' || !is_file($f)) throw new RuntimeException('Không tìm thấy tệp video/ảnh của bài.');
    return $f;
}

function pub_facebook(array $post): array
{
    $pg = cfg('fb_page');
    if (!$pg) throw new RuntimeException('Chưa kết nối Fanpage Facebook.');
    $caption = (string)$post['caption'];
    if ($post['media_type'] === 'video') {
        media_path($post);
        $j = graph('POST', $pg['id'] . '/videos', [
            'file_url' => media_url($post['media']), 'description' => $caption,
            'title' => (string)$post['title'], 'access_token' => $pg['token'],
        ], 'graph-video.facebook.com');
        $id = (string)($j['id'] ?? '');
        return ['status' => 'done', 'remote' => $id, 'url' => "https://www.facebook.com/{$pg['id']}/videos/$id", 'error' => '', 'state' => []];
    }
    if ($post['media_type'] === 'image') {
        media_path($post);
        $j = graph('POST', $pg['id'] . '/photos', ['url' => media_url($post['media']), 'caption' => $caption, 'access_token' => $pg['token']]);
        $id = (string)($j['post_id'] ?? $j['id'] ?? '');
        return ['status' => 'done', 'remote' => $id, 'url' => "https://www.facebook.com/$id", 'error' => '', 'state' => []];
    }
    $msg = trim(($post['title'] !== '' ? $post['title'] . "\n\n" : '') . $caption);
    $j = graph('POST', $pg['id'] . '/feed', ['message' => $msg, 'access_token' => $pg['token']]);
    $id = (string)($j['id'] ?? '');
    return ['status' => 'done', 'remote' => $id, 'url' => "https://www.facebook.com/$id", 'error' => '', 'state' => []];
}

function pub_instagram(array $post, array $state): array
{
    $ig = cfg('ig_account');
    $pg = cfg('fb_page');
    if (!$ig || !$pg) throw new RuntimeException('Chưa kết nối tài khoản Instagram (cần là tài khoản Business/Creator liên kết với Fanpage).');
    $tok = $pg['token'];
    if (empty($state['c'])) {
        media_path($post);
        $params = ['caption' => (string)$post['caption'], 'access_token' => $tok];
        if ($post['media_type'] === 'video') {
            $params += ['media_type' => 'REELS', 'video_url' => media_url($post['media']), 'share_to_feed' => 'true'];
        } else {
            $params['image_url'] = media_url($post['media']);
        }
        $j = graph('POST', $ig['id'] . '/media', $params);
        $state = ['c' => (string)$j['id'], 't' => time()];
    }
    // Ảnh thường xử lý xong ngay; video kiểm tra lại ở các lần chạy sau.
    for ($i = 0; $i < ($post['media_type'] === 'video' ? 1 : 6); $i++) {
        if ($i) sleep(5);
        $s = graph('GET', $state['c'], ['fields' => 'status_code,status', 'access_token' => $tok]);
        $code = $s['status_code'] ?? '';
        if ($code === 'FINISHED') {
            $j = graph('POST', $ig['id'] . '/media_publish', ['creation_id' => $state['c'], 'access_token' => $tok]);
            $id = (string)$j['id'];
            $url = '';
            try { $url = (string)(graph('GET', $id, ['fields' => 'permalink', 'access_token' => $tok])['permalink'] ?? ''); } catch (Throwable $e) {}
            return ['status' => 'done', 'remote' => $id, 'url' => $url, 'error' => '', 'state' => $state];
        }
        if ($code === 'ERROR' || $code === 'EXPIRED') {
            throw new RuntimeException('Instagram không xử lý được tệp: ' . ($s['status'] ?? $code));
        }
    }
    if (time() - (int)$state['t'] > 7200) throw new RuntimeException('Instagram xử lý video quá 2 giờ, đã dừng.');
    return ['status' => 'processing', 'remote' => '', 'url' => '', 'error' => '', 'state' => $state];
}

function pub_youtube(array $post): array
{
    $file = media_path($post);
    $tok = yt_token();
    $title = trim((string)$post['title']);
    if ($title === '') $title = trim(strtok((string)$post['caption'], "\n") ?: 'Video Tết Chay An Lạc');
    $title = mb_substr(str_replace(['<', '>'], '', $title), 0, 100);
    $desc = mb_strcut(str_replace(['<', '>'], '', (string)$post['caption']), 0, 5000, 'UTF-8');
    $mime = $post['media'] !== '' && str_ends_with($post['media'], '.mov') ? 'video/quicktime' : 'video/mp4';
    $size = filesize($file);
    $r = http('POST', 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', [
        'headers' => ['Authorization: Bearer ' . $tok, "X-Upload-Content-Length: $size", "X-Upload-Content-Type: $mime"],
        'json' => [
            'snippet' => ['title' => $title, 'description' => $desc, 'categoryId' => '22'],
            'status' => ['privacyStatus' => cfg('yt_privacy', 'public'), 'selfDeclaredMadeForKids' => false],
        ],
    ]);
    $loc = $r['headers']['location'] ?? '';
    if ($r['code'] !== 200 || $loc === '') {
        throw new RuntimeException('YouTube từ chối tải lên: ' . ($r['json']['error']['message'] ?? 'HTTP ' . $r['code']));
    }
    $r = http('PUT', $loc, ['headers' => ['Authorization: Bearer ' . $tok, "Content-Type: $mime"], 'file' => $file, 'timeout' => 4 * 3600]);
    $id = $r['json']['id'] ?? '';
    if (($r['code'] !== 200 && $r['code'] !== 201) || $id === '') {
        throw new RuntimeException('YouTube tải video lỗi: ' . ($r['json']['error']['message'] ?? 'HTTP ' . $r['code']));
    }
    return ['status' => 'done', 'remote' => $id, 'url' => "https://youtu.be/$id", 'error' => '', 'state' => []];
}

function pub_tiktok(array $post, array $state): array
{
    if (empty($state['pid'])) {
        $file = media_path($post);
        $size = filesize($file);
        $info = tiktok_api('post/publish/creator_info/query/', new stdClass());
        $opts = $info['privacy_level_options'] ?? [];
        $want = (string)cfg('tt_privacy', 'PUBLIC_TO_EVERYONE');
        $privacy = in_array($want, $opts, true) ? $want : (in_array('SELF_ONLY', $opts, true) ? 'SELF_ONLY' : ($opts[0] ?? 'SELF_ONLY'));
        // Quy tắc chia phần của TikTok: mỗi phần 5–64 MB, phần cuối chứa phần dư (tối đa 128 MB).
        if ($size <= 64 * 1048576) { $chunk = $size; $count = 1; }
        else { $chunk = 10 * 1048576; $count = intdiv($size, $chunk); }
        $title = mb_substr(trim(($post['title'] !== '' && $post['caption'] === '' ? $post['title'] : $post['caption'])), 0, 2200);
        $data = tiktok_api('post/publish/video/init/', [
            'post_info' => [
                'title' => $title, 'privacy_level' => $privacy,
                'disable_duet' => false, 'disable_comment' => false, 'disable_stitch' => false,
                'video_cover_timestamp_ms' => 1000,
            ],
            'source_info' => ['source' => 'FILE_UPLOAD', 'video_size' => $size, 'chunk_size' => $chunk, 'total_chunk_count' => $count],
        ]);
        $mime = str_ends_with($post['media'], '.mov') ? 'video/quicktime' : 'video/mp4';
        $fh = fopen($file, 'rb');
        for ($i = 0; $i < $count; $i++) {
            $start = $i * $chunk;
            $end = $i === $count - 1 ? $size - 1 : $start + $chunk - 1;
            fseek($fh, $start);
            $buf = fread($fh, $end - $start + 1);
            $r = http('PUT', $data['upload_url'], [
                'headers' => ["Content-Type: $mime", 'Content-Length: ' . strlen($buf), "Content-Range: bytes $start-$end/$size"],
                'body' => $buf, 'timeout' => 1800,
            ]);
            unset($buf);
            if ($r['code'] >= 300) { fclose($fh); throw new RuntimeException("TikTok tải video lỗi ở phần " . ($i + 1) . " (HTTP {$r['code']})."); }
        }
        fclose($fh);
        $state = ['pid' => $data['publish_id'], 't' => time(), 'privacy' => $privacy];
    }
    $s = tiktok_api('post/publish/status/fetch/', ['publish_id' => $state['pid']]);
    $st = $s['status'] ?? '';
    if ($st === 'PUBLISH_COMPLETE') {
        $ids = $s['publicaly_available_post_id'] ?? [];
        $id = $ids ? (string)$ids[0] : (string)$state['pid'];
        $note = $state['privacy'] === 'SELF_ONLY' ? 'Đăng ở chế độ "Chỉ mình tôi" (ứng dụng TikTok chưa được duyệt).' : '';
        return ['status' => 'done', 'remote' => $id, 'url' => '', 'error' => $note, 'state' => $state];
    }
    if ($st === 'FAILED') throw new RuntimeException('TikTok báo lỗi: ' . ($s['fail_reason'] ?? 'không rõ'));
    if (time() - (int)$state['t'] > 7200) throw new RuntimeException('TikTok xử lý video quá 2 giờ, đã dừng.');
    return ['status' => 'processing', 'remote' => '', 'url' => '', 'error' => '', 'state' => $state];
}
