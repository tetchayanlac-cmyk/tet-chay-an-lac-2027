<?php
// Module "Đăng bài MXH" – API cho giao diện quản lý
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function out(array $d, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail(string $m, int $code = 400): never { out(['error' => $m], $code); }

set_exception_handler(function (Throwable $e) {
    if ($e instanceof UserError) out(['error' => $e->getMessage()], 400);
    error_log('dang-bai api: ' . $e);
    out(['error' => 'Lỗi máy chủ, vui lòng thử lại.'], 500);
});

start_session();
$action = (string)($_GET['action'] ?? '');
$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$in = [];
if ($isPost && str_starts_with((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
}

/* ---------- Đăng nhập ---------- */

if ($action === 'login') {
    if (!$isPost) fail('Sai phương thức.', 405);
    $ip = client_ip();
    q('DELETE FROM logins WHERE ts<?', [time() - 900]);
    if ((int)q('SELECT COUNT(*) FROM logins WHERE ip=?', [$ip])->fetchColumn() >= 8) {
        fail('Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.', 429);
    }
    $user = strtolower(trim((string)($in['username'] ?? '')));
    $pass = (string)($in['password'] ?? '');
    $u = q('SELECT * FROM users WHERE username=?', [$user])->fetch();
    if (!$u || !(int)$u['active'] || !password_verify($pass, $u['pass'])) {
        q('INSERT INTO logins(ip,ts) VALUES(?,?)', [$ip, time()]);
        usleep(400000);
        fail('Sai tên đăng nhập hoặc mật khẩu.', 401);
    }
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
    nhat_ky((int)$u['id'], 'dang-nhap', $ip);
    out(['ok' => true]);
}

$me = current_user();

if ($action === 'me') {
    if (!$me) out(['user' => null]);
    $flash = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    out([
        'user' => $me,
        'csrf' => $_SESSION['csrf'] ?? '',
        'platforms' => PLATFORMS,
        'connected' => connected_map(),
        'dryRun' => (bool)cfg('dry_run', false),
        'flash' => $flash,
    ]);
}

if ($action === 'logout') {
    $_SESSION = [];
    session_destroy();
    out(['ok' => true]);
}

if (!$me) fail('Phiên đăng nhập đã hết, vui lòng đăng nhập lại.', 401);
if ($isPost && !hash_equals((string)($_SESSION['csrf'] ?? ''), (string)($_SERVER['HTTP_X_CSRF'] ?? ''))) {
    fail('Phiên làm việc không hợp lệ, hãy tải lại trang.', 403);
}
$isAdmin = $me['role'] === 'admin';
function need_admin(): void { global $isAdmin; if (!$isAdmin) fail('Chỉ quản trị viên được làm việc này.', 403); }
function need_post(): void { global $isPost; if (!$isPost) fail('Sai phương thức.', 405); }

function connected_map(): array
{
    $dry = (bool)cfg('dry_run', false);
    $fb = cfg('fb_page');
    $ig = cfg('ig_account');
    $yt = cfg('yt');
    $tt = cfg('tt');
    return [
        'facebook' => $fb ? $fb['name'] : ($dry ? 'Chạy thử' : ''),
        'instagram' => $ig ? '@' . $ig['username'] : ($dry ? 'Chạy thử' : ''),
        'youtube' => $yt ? $yt['channel_name'] : ($dry ? 'Chạy thử' : ''),
        'tiktok' => $tt ? $tt['name'] : ($dry ? 'Chạy thử' : ''),
    ];
}

function load_post(int $id): array
{
    $p = q('SELECT * FROM posts WHERE id=?', [$id])->fetch();
    if (!$p) fail('Không tìm thấy bài đăng.', 404);
    return $p;
}

function public_post(array $p, array|object $results, array $names): array
{
    return [
        'id' => (int)$p['id'],
        'author' => (int)$p['author'],
        'authorName' => $names[(int)$p['author']] ?? '?',
        'title' => $p['title'],
        'caption' => $p['caption'],
        'media' => $p['media'],
        'mediaType' => $p['media_type'],
        'mediaSize' => (int)$p['media_size'],
        'mediaName' => $p['media_name'],
        'mediaUrl' => $p['media'] !== '' ? 'kho/media/' . rawurlencode($p['media']) : '',
        'platforms' => post_platforms($p),
        'scheduled' => $p['scheduled'] === null ? null : (int)$p['scheduled'],
        'status' => $p['status'],
        'note' => $p['note'],
        'reviewerName' => $p['reviewer'] ? ($names[(int)$p['reviewer']] ?? '?') : '',
        'reviewed' => $p['reviewed'] ? (int)$p['reviewed'] : null,
        'created' => (int)$p['created'],
        'updated' => (int)$p['updated'],
        'results' => $results,
    ];
}

function user_names(): array
{
    $n = [];
    foreach (q('SELECT id,name,username FROM users')->fetchAll() as $u) $n[(int)$u['id']] = $u['name'] ?: $u['username'];
    return $n;
}

/* ---------- Bài đăng ---------- */

if ($action === 'posts') {
    $rows = q('SELECT * FROM posts ORDER BY updated DESC LIMIT 500')->fetchAll();
    $res = [];
    if ($rows) {
        $ids = implode(',', array_map(fn($r) => (int)$r['id'], $rows));
        foreach (q("SELECT post,platform,status,url,error,remote,updated FROM results WHERE post IN ($ids)")->fetchAll() as $r) {
            $res[(int)$r['post']][$r['platform']] = ['status' => $r['status'], 'url' => $r['url'], 'error' => $r['error'], 'remote' => $r['remote'], 'updated' => (int)$r['updated']];
        }
    }
    $names = user_names();
    out(['posts' => array_map(fn($p) => public_post($p, $res[(int)$p['id']] ?? (object)[], $names), $rows)]);
}

if ($action === 'post-save') {
    need_post();
    $id = (int)($in['id'] ?? 0);
    $mode = (string)($in['mode'] ?? 'draft'); // draft | submit | approve
    if ($mode === 'approve') need_admin();
    $old = $id ? load_post($id) : null;
    if ($old) {
        $editable = $isAdmin ? ['draft', 'pending', 'rejected', 'approved'] : ['draft', 'pending', 'rejected'];
        if (!in_array($old['status'], $editable, true)) fail('Bài này đã duyệt/đang đăng, không sửa được nữa.');
        if (!$isAdmin && (int)$old['author'] !== $me['id']) fail('Bạn chỉ được sửa bài của mình.', 403);
    }
    $media = (string)($in['media'] ?? '');
    $mediaType = '';
    $mediaSize = 0;
    if ($media !== '') {
        if (!preg_match('/^[a-f0-9]{32}\.(mp4|mov|jpg)$/', $media, $m) || !is_file(MEDIA_DIR . '/' . $media)) fail('Tệp video/ảnh không hợp lệ, hãy tải lên lại.');
        $mediaType = $m[1] === 'jpg' ? 'image' : 'video';
        $mediaSize = (int)filesize(MEDIA_DIR . '/' . $media);
    }
    $platforms = array_values(array_intersect(array_keys(PLATFORMS), (array)($in['platforms'] ?? [])));
    $scheduled = $in['scheduled'] ?? null;
    $scheduled = ($scheduled === null || $scheduled === '') ? null : (int)$scheduled;
    $p = [
        'title' => mb_substr(trim((string)($in['title'] ?? '')), 0, 200),
        'caption' => mb_substr(trim((string)($in['caption'] ?? '')), 0, 5000),
        'media' => $media,
        'media_type' => $mediaType,
        'media_size' => $mediaSize,
        'media_name' => mb_substr((string)($in['mediaName'] ?? ''), 0, 200),
        'platforms' => json_encode($platforms),
        'scheduled' => $scheduled,
    ];
    if ($p['title'] === '' && $p['caption'] === '' && $media === '') fail('Bài đăng đang trống.');
    if ($mode !== 'draft') {
        $prob = post_problems($p);
        if ($prob) fail(implode(' ', $prob));
    }
    if ($mode === 'approve') $status = 'approved';
    elseif ($mode === 'submit') $status = 'pending';
    elseif ($old && $old['status'] === 'approved') $status = 'approved';
    else $status = 'draft';
    $now = time();
    if ($old) {
        q('UPDATE posts SET title=?,caption=?,media=?,media_type=?,media_size=?,media_name=?,platforms=?,scheduled=?,status=?,note=?,updated=? WHERE id=?',
            [$p['title'], $p['caption'], $media, $mediaType, $mediaSize, $p['media_name'], $p['platforms'], $scheduled, $status,
                $status === 'approved' ? $old['note'] : '', $now, $id]);
        if ($old['media'] !== $media) delete_media($old['media'], $id);
    } else {
        q('INSERT INTO posts(author,title,caption,media,media_type,media_size,media_name,platforms,scheduled,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            [$me['id'], $p['title'], $p['caption'], $media, $mediaType, $mediaSize, $p['media_name'], $p['platforms'], $scheduled, $status, $now, $now]);
        $id = (int)db()->lastInsertId();
    }
    if ($status === 'approved') {
        if ($mode === 'approve') q('UPDATE posts SET reviewer=?, reviewed=? WHERE id=?', [$me['id'], $now, $id]);
        reset_results($id, $platforms);
    } else {
        q('DELETE FROM results WHERE post=?', [$id]);
    }
    nhat_ky($me['id'], 'luu-bai', "#$id $status");
    out(['ok' => true, 'id' => $id, 'status' => $status]);
}

if ($action === 'post-review') {
    need_post();
    need_admin();
    $p = load_post((int)($in['id'] ?? 0));
    $id = (int)$p['id'];
    $do = (string)($in['do'] ?? '');
    $now = time();
    switch ($do) {
        case 'approve':
        case 'publish-now':
            if (!in_array($p['status'], ['pending', 'draft', 'rejected', 'approved'], true)) fail('Bài đã đăng hoặc đang đăng.');
            $prob = post_problems($p);
            if ($prob) fail(implode(' ', $prob));
            $sched = $do === 'publish-now' ? $now : ($p['scheduled'] === null ? null : (int)$p['scheduled']);
            q("UPDATE posts SET status='approved', scheduled=?, reviewer=?, reviewed=?, note='', updated=? WHERE id=?", [$sched, $me['id'], $now, $now, $id]);
            reset_results($id, post_platforms($p));
            break;
        case 'reject':
            if (!in_array($p['status'], ['pending', 'approved', 'draft'], true)) fail('Không trả lại được bài ở trạng thái này.');
            $note = mb_substr(trim((string)($in['note'] ?? '')), 0, 1000);
            q("UPDATE posts SET status='rejected', note=?, reviewer=?, reviewed=?, updated=? WHERE id=?", [$note, $me['id'], $now, $now, $id]);
            q('DELETE FROM results WHERE post=?', [$id]);
            break;
        case 'unapprove':
            if ($p['status'] !== 'approved') fail('Bài chưa được duyệt.');
            q("UPDATE posts SET status='pending', updated=? WHERE id=?", [$now, $id]);
            q('DELETE FROM results WHERE post=?', [$id]);
            break;
        case 'retry':
            $pl = (string)($in['platform'] ?? '');
            $n = q("UPDATE results SET status='waiting', error='', state='{}', updated=? WHERE post=? AND platform=? AND status='failed'", [$now, $id, $pl])->rowCount();
            if (!$n) fail('Không có nền tảng lỗi để đăng lại.');
            q("UPDATE posts SET status='publishing', updated=? WHERE id=?", [$now, $id]);
            break;
        default:
            fail('Thao tác không hợp lệ.');
    }
    nhat_ky($me['id'], $do, "#$id");
    out(['ok' => true]);
}

if ($action === 'post-delete') {
    need_post();
    $p = load_post((int)($in['id'] ?? 0));
    if ($p['status'] === 'publishing') fail('Bài đang được đăng, chưa xóa được.');
    if (!$isAdmin && ((int)$p['author'] !== $me['id'] || !in_array($p['status'], ['draft', 'pending', 'rejected'], true))) {
        fail('Bạn chỉ được xóa bài của mình khi chưa được duyệt.', 403);
    }
    q('DELETE FROM results WHERE post=?', [$p['id']]);
    q('DELETE FROM posts WHERE id=?', [$p['id']]);
    delete_media($p['media']);
    nhat_ky($me['id'], 'xoa-bai', '#' . $p['id']);
    out(['ok' => true]);
}

/* ---------- Tải tệp theo từng phần (mỗi phần ≤ 4 MB) ---------- */

if ($action === 'upload-chunk') {
    need_post();
    $uid = (string)($_POST['uid'] ?? '');
    $index = (int)($_POST['index'] ?? -1);
    $total = (int)($_POST['total'] ?? 0);
    $size = (int)($_POST['size'] ?? 0);
    if (!preg_match('/^[a-f0-9]{16,40}$/', $uid) || $index < 0 || $total < 1 || $index >= $total) fail('Dữ liệu tải lên không hợp lệ.');
    if ($size < 1 || $size > MAX_UPLOAD) fail('Tệp quá lớn (tối đa 2 GB).');
    $f = $_FILES['chunk'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail('Tải lên bị lỗi, hãy thử lại.');
    $part = TAM_DIR . '/' . $uid . '.part';
    $up = $_SESSION['up'][$uid] ?? null;
    if ($index === 0) {
        foreach (glob(TAM_DIR . '/*.part') ?: [] as $old) if (filemtime($old) < time() - 86400) @unlink($old);
        $_SESSION['up'][$uid] = ['next' => 0, 'size' => $size, 'total' => $total];
        file_put_contents($part, '');
        $up = $_SESSION['up'][$uid];
    }
    if (!$up || $up['next'] !== $index || $up['size'] !== $size || $up['total'] !== $total) fail('Thứ tự tải lên bị lệch, hãy tải lại tệp.');
    $in2 = fopen($f['tmp_name'], 'rb');
    $outF = fopen($part, 'ab');
    stream_copy_to_stream($in2, $outF);
    fclose($in2);
    fclose($outF);
    clearstatcache(true, $part);
    if (filesize($part) > $size) { @unlink($part); unset($_SESSION['up'][$uid]); fail('Tệp tải lên bị lỗi kích thước.'); }
    $_SESSION['up'][$uid]['next'] = $index + 1;
    if ($index < $total - 1) out(['ok' => true, 'next' => $index + 1]);

    unset($_SESSION['up'][$uid]);
    if (filesize($part) !== $size) { @unlink($part); fail('Tệp tải lên chưa đủ dữ liệu, hãy thử lại.'); }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($part);
    if (!isset(MEDIA_TYPES[$mime])) { @unlink($part); fail('Chỉ nhận video MP4/MOV hoặc ảnh JPG.'); }
    $name = bin2hex(random_bytes(16)) . '.' . MEDIA_TYPES[$mime];
    rename($part, MEDIA_DIR . '/' . $name);
    @chmod(MEDIA_DIR . '/' . $name, 0644);
    out(['ok' => true, 'file' => $name, 'mediaType' => MEDIA_TYPES[$mime] === 'jpg' ? 'image' : 'video', 'size' => $size, 'url' => 'kho/media/' . $name]);
}

/* ---------- Tài khoản ---------- */

if ($action === 'password') {
    need_post();
    $u = q('SELECT pass FROM users WHERE id=?', [$me['id']])->fetch();
    if (!password_verify((string)($in['old'] ?? ''), $u['pass'])) fail('Mật khẩu hiện tại không đúng.');
    $new = (string)($in['new'] ?? '');
    if (mb_strlen($new) < 8) fail('Mật khẩu mới cần ít nhất 8 ký tự.');
    q('UPDATE users SET pass=? WHERE id=?', [password_hash($new, PASSWORD_DEFAULT), $me['id']]);
    nhat_ky($me['id'], 'doi-mat-khau');
    out(['ok' => true]);
}

if ($action === 'users') {
    need_admin();
    $rows = q('SELECT id,username,name,role,active,created FROM users ORDER BY role, username')->fetchAll();
    $cnt = [];
    foreach (q('SELECT author, COUNT(*) c FROM posts GROUP BY author')->fetchAll() as $r) $cnt[(int)$r['author']] = (int)$r['c'];
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['active'] = (int)$r['active']; $r['posts'] = $cnt[$r['id']] ?? 0; }
    out(['users' => $rows]);
}

if ($action === 'user-save') {
    need_post();
    need_admin();
    $id = (int)($in['id'] ?? 0);
    $name = mb_substr(trim((string)($in['name'] ?? '')), 0, 80);
    $role = ($in['role'] ?? 'staff') === 'admin' ? 'admin' : 'staff';
    $active = !empty($in['active']) ? 1 : 0;
    $pass = (string)($in['password'] ?? '');
    if ($pass !== '' && mb_strlen($pass) < 8) fail('Mật khẩu cần ít nhất 8 ký tự.');
    if ($id) {
        $u = q('SELECT * FROM users WHERE id=?', [$id])->fetch();
        if (!$u) fail('Không tìm thấy tài khoản.', 404);
        if ($id === $me['id'] && ($role !== 'admin' || !$active)) fail('Không thể tự khóa hoặc tự hạ quyền tài khoản đang dùng.');
        q('UPDATE users SET name=?, role=?, active=? WHERE id=?', [$name ?: $u['username'], $role, $active, $id]);
        if ($pass !== '') q('UPDATE users SET pass=? WHERE id=?', [password_hash($pass, PASSWORD_DEFAULT), $id]);
    } else {
        $username = strtolower(trim((string)($in['username'] ?? '')));
        if (!preg_match('/^[a-z0-9._-]{3,32}$/', $username)) fail('Tên đăng nhập 3–32 ký tự, chỉ gồm chữ thường không dấu, số, dấu chấm, gạch.');
        if (q('SELECT 1 FROM users WHERE username=?', [$username])->fetchColumn()) fail('Tên đăng nhập đã có người dùng.');
        if ($pass === '') fail('Cần đặt mật khẩu cho tài khoản mới.');
        q('INSERT INTO users(username,name,pass,role,active,created) VALUES(?,?,?,?,?,?)',
            [$username, $name ?: $username, password_hash($pass, PASSWORD_DEFAULT), $role, 1, time()]);
        $id = (int)db()->lastInsertId();
    }
    nhat_ky($me['id'], 'tai-khoan', "#$id $role " . ($active ? 'mo' : 'khoa'));
    out(['ok' => true, 'id' => $id]);
}

/* ---------- Kết nối mạng xã hội ---------- */

function mask(?string $s): string
{
    $s = (string)$s;
    return $s === '' ? '' : '••••••' . substr($s, -4);
}

if ($action === 'settings') {
    need_admin();
    $yt = cfg('yt');
    $tt = cfg('tt');
    out([
        'redirectUri' => base_url() . '/oauth.php',
        'baseUrl' => base_url(),
        'dryRun' => (bool)cfg('dry_run', false),
        'fbVer' => cfg('fb_ver', 'v24.0'),
        'fbAppId' => (string)cfg('fb_app_id', ''),
        'fbAppSecret' => mask(cfg('fb_app_secret')),
        'fbConfigId' => (string)cfg('fb_config_id', ''),
        'fbPages' => array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name'], 'ig' => $p['ig']['username'] ?? ''], cfg('fb_pages', [])),
        'fbPage' => cfg('fb_page') ? ['id' => cfg('fb_page')['id'], 'name' => cfg('fb_page')['name']] : null,
        'igAccount' => cfg('ig_account'),
        'googleClientId' => (string)cfg('google_client_id', ''),
        'googleClientSecret' => mask(cfg('google_client_secret')),
        'ytPrivacy' => cfg('yt_privacy', 'public'),
        'yt' => $yt ? ['channel' => $yt['channel_name'], 'id' => $yt['channel_id']] : null,
        'tiktokClientKey' => (string)cfg('tiktok_client_key', ''),
        'tiktokClientSecret' => mask(cfg('tiktok_client_secret')),
        'ttPrivacy' => cfg('tt_privacy', 'PUBLIC_TO_EVERYONE'),
        'tt' => $tt ? ['name' => $tt['name']] : null,
    ]);
}

if ($action === 'settings-save') {
    need_post();
    need_admin();
    foreach (['fb_app_id' => 'fbAppId', 'fb_config_id' => 'fbConfigId', 'google_client_id' => 'googleClientId', 'tiktok_client_key' => 'tiktokClientKey'] as $k => $f) {
        if (array_key_exists($f, $in)) cfg_set($k, trim((string)$in[$f]));
    }
    foreach (['fb_app_secret' => 'fbAppSecret', 'google_client_secret' => 'googleClientSecret', 'tiktok_client_secret' => 'tiktokClientSecret'] as $k => $f) {
        $v = trim((string)($in[$f] ?? ''));
        if ($v !== '' && !str_starts_with($v, '••')) cfg_set($k, $v);
    }
    if (isset($in['ytPrivacy']) && in_array($in['ytPrivacy'], ['public', 'unlisted', 'private'], true)) cfg_set('yt_privacy', $in['ytPrivacy']);
    if (isset($in['ttPrivacy']) && in_array($in['ttPrivacy'], ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'], true)) cfg_set('tt_privacy', $in['ttPrivacy']);
    if (isset($in['fbVer']) && preg_match('/^v\d{2}\.0$/', (string)$in['fbVer'])) cfg_set('fb_ver', $in['fbVer']);
    if (array_key_exists('dryRun', $in)) cfg_set('dry_run', (bool)$in['dryRun']);
    if (isset($in['fbPage'])) {
        $sel = null;
        foreach (cfg('fb_pages', []) as $pg) if ((string)$pg['id'] === (string)$in['fbPage']) $sel = $pg;
        if (!$sel) fail('Không tìm thấy Fanpage đã chọn.');
        cfg_set('fb_page', ['id' => $sel['id'], 'name' => $sel['name'], 'token' => $sel['token']]);
        cfg_set('ig_account', !empty($sel['ig']['id']) ? $sel['ig'] : null);
    }
    if (isset($in['disconnect'])) {
        switch ($in['disconnect']) {
            case 'facebook': cfg_set('fb_page', null); cfg_set('fb_pages', null); cfg_set('ig_account', null); break;
            case 'instagram': cfg_set('ig_account', null); break;
            case 'youtube': cfg_set('yt', null); break;
            case 'tiktok': cfg_set('tt', null); break;
        }
    }
    nhat_ky($me['id'], 'cai-dat');
    out(['ok' => true]);
}

if ($action === 'log') {
    need_admin();
    $names = user_names();
    $rows = q('SELECT ts,user,action,detail FROM log ORDER BY id DESC LIMIT 200')->fetchAll();
    foreach ($rows as &$r) { $r['who'] = $r['user'] ? ($names[(int)$r['user']] ?? '?') : 'Hệ thống'; }
    out(['log' => $rows]);
}

fail('Không có chức năng này.', 404);
