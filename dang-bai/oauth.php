<?php
// Module "Đăng bài MXH" – kết nối tài khoản Facebook/Instagram, YouTube, TikTok (OAuth)
// Địa chỉ chuyển hướng cần khai báo ở cả 3 nơi: https://tetchayanlac.com/dang-bai/oauth.php
declare(strict_types=1);
require __DIR__ . '/platforms.php';
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

start_session();
$u = current_user();
if (!$u || $u['role'] !== 'admin') {
    http_response_code(403);
    exit('Cần đăng nhập bằng tài khoản quản trị ở trang Đăng bài trước.');
}

function back(string $msg, bool $ok): never
{
    $_SESSION['flash'] = ['msg' => $msg, 'ok' => $ok];
    header('Location: ./#ket-noi');
    exit;
}

$redirect = base_url() . '/oauth.php';

if (isset($_GET['start'])) {
    $p = (string)$_GET['start'];
    $state = $p . '.' . bin2hex(random_bytes(16));
    $_SESSION['oauth_state'] = $state;
    switch ($p) {
        case 'facebook':
            if (!cfg('fb_app_id') || !cfg('fb_app_secret')) back('Hãy nhập và lưu App ID, App Secret của Meta trước.', false);
            $url = 'https://www.facebook.com/' . fb_ver() . '/dialog/oauth?' . http_build_query([
                'client_id' => cfg('fb_app_id'), 'redirect_uri' => $redirect, 'state' => $state, 'response_type' => 'code',
                'scope' => 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management',
            ]);
            break;
        case 'youtube':
            if (!cfg('google_client_id') || !cfg('google_client_secret')) back('Hãy nhập và lưu Client ID, Client secret của Google trước.', false);
            $url = 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
                'client_id' => cfg('google_client_id'), 'redirect_uri' => $redirect, 'response_type' => 'code', 'state' => $state,
                'scope' => 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
                'access_type' => 'offline', 'prompt' => 'consent', 'include_granted_scopes' => 'true',
            ]);
            break;
        case 'tiktok':
            if (!cfg('tiktok_client_key') || !cfg('tiktok_client_secret')) back('Hãy nhập và lưu Client key, Client secret của TikTok trước.', false);
            $url = 'https://www.tiktok.com/v2/auth/authorize/?' . http_build_query([
                'client_key' => cfg('tiktok_client_key'), 'redirect_uri' => $redirect, 'state' => $state,
                'response_type' => 'code', 'scope' => 'user.info.basic,video.publish',
            ]);
            break;
        default:
            back('Nền tảng không hợp lệ.', false);
    }
    header('Location: ' . $url);
    exit;
}

$state = (string)($_GET['state'] ?? '');
$expect = (string)($_SESSION['oauth_state'] ?? '');
unset($_SESSION['oauth_state']);
if ($state === '' || $expect === '' || !hash_equals($expect, $state)) back('Phiên kết nối không hợp lệ hoặc đã hết hạn, hãy bấm Kết nối lại.', false);
$p = explode('.', $state)[0];
$name = PLATFORMS[$p] ?? $p;
if (isset($_GET['error']) || empty($_GET['code'])) {
    back("Chưa kết nối $name: " . (string)($_GET['error_description'] ?? $_GET['error'] ?? 'bạn đã hủy.'), false);
}
$code = (string)$_GET['code'];

try {
    switch ($p) {
        case 'facebook':
            $j = graph('GET', 'oauth/access_token', ['client_id' => cfg('fb_app_id'), 'client_secret' => cfg('fb_app_secret'), 'redirect_uri' => $redirect, 'code' => $code]);
            $tok = (string)$j['access_token'];
            // Đổi sang token dài hạn để token Fanpage không hết hạn
            try {
                $j = graph('GET', 'oauth/access_token', ['grant_type' => 'fb_exchange_token', 'client_id' => cfg('fb_app_id'), 'client_secret' => cfg('fb_app_secret'), 'fb_exchange_token' => $tok]);
                $tok = (string)($j['access_token'] ?? $tok);
            } catch (Throwable $e) {}
            $j = graph('GET', 'me/accounts', ['fields' => 'id,name,access_token,instagram_business_account{id,username}', 'limit' => 100, 'access_token' => $tok]);
            $pages = [];
            foreach ($j['data'] ?? [] as $pg) {
                $pages[] = ['id' => (string)$pg['id'], 'name' => (string)$pg['name'], 'token' => (string)$pg['access_token'],
                    'ig' => isset($pg['instagram_business_account']['id']) ? ['id' => (string)$pg['instagram_business_account']['id'], 'username' => (string)($pg['instagram_business_account']['username'] ?? '')] : null];
            }
            if (!$pages) back('Tài khoản Facebook này không quản trị Fanpage nào (hoặc chưa cấp quyền Fanpage).', false);
            cfg_set('fb_pages', $pages);
            $cur = cfg('fb_page');
            $sel = null;
            foreach ($pages as $pg) if ($cur && $pg['id'] === $cur['id']) $sel = $pg;
            if (!$sel && count($pages) === 1) $sel = $pages[0];
            if ($sel) {
                cfg_set('fb_page', ['id' => $sel['id'], 'name' => $sel['name'], 'token' => $sel['token']]);
                cfg_set('ig_account', $sel['ig']);
                $msg = 'Đã kết nối Fanpage "' . $sel['name'] . '"' . ($sel['ig'] ? ' và Instagram @' . $sel['ig']['username'] : ' (Fanpage chưa liên kết tài khoản Instagram Business)') . '.';
            } else {
                $msg = 'Đã kết nối Facebook. Hãy chọn Fanpage dùng để đăng bài.';
            }
            nhat_ky($u['id'], 'ket-noi', 'facebook');
            back($msg, true);

        case 'youtube':
            $r = http('POST', 'https://oauth2.googleapis.com/token', ['form' => [
                'code' => $code, 'client_id' => cfg('google_client_id'), 'client_secret' => cfg('google_client_secret'),
                'redirect_uri' => $redirect, 'grant_type' => 'authorization_code',
            ]]);
            $j = $r['json'] ?? [];
            if (empty($j['access_token'])) back('Google từ chối: ' . ($j['error_description'] ?? $j['error'] ?? 'HTTP ' . $r['code']), false);
            if (empty($j['refresh_token'])) back('Google không cấp quyền dài hạn. Hãy vào myaccount.google.com/permissions gỡ ứng dụng rồi kết nối lại.', false);
            $c = http('GET', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', ['headers' => ['Authorization: Bearer ' . $j['access_token']]]);
            $ch = $c['json']['items'][0] ?? null;
            if (!$ch) back('Tài khoản Google này chưa có kênh YouTube.', false);
            cfg_set('yt', ['access' => $j['access_token'], 'refresh' => $j['refresh_token'], 'expires' => time() + (int)($j['expires_in'] ?? 3600),
                'channel_id' => (string)$ch['id'], 'channel_name' => (string)$ch['snippet']['title']]);
            nhat_ky($u['id'], 'ket-noi', 'youtube');
            back('Đã kết nối kênh YouTube "' . $ch['snippet']['title'] . '".', true);

        case 'tiktok':
            $r = http('POST', 'https://open.tiktokapis.com/v2/oauth/token/', ['form' => [
                'client_key' => cfg('tiktok_client_key'), 'client_secret' => cfg('tiktok_client_secret'),
                'code' => $code, 'grant_type' => 'authorization_code', 'redirect_uri' => $redirect,
            ]]);
            $j = $r['json'] ?? [];
            if (empty($j['access_token'])) back('TikTok từ chối: ' . ($j['error_description'] ?? $j['error'] ?? 'HTTP ' . $r['code']), false);
            $info = http('GET', 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', ['headers' => ['Authorization: Bearer ' . $j['access_token']]]);
            $nm = (string)($info['json']['data']['user']['display_name'] ?? 'TikTok');
            cfg_set('tt', ['access' => $j['access_token'], 'refresh' => $j['refresh_token'] ?? '', 'expires' => time() + (int)($j['expires_in'] ?? 86400),
                'open_id' => (string)($j['open_id'] ?? ''), 'name' => $nm]);
            nhat_ky($u['id'], 'ket-noi', 'tiktok');
            back("Đã kết nối TikTok \"$nm\".", true);
    }
    back('Nền tảng không hợp lệ.', false);
} catch (Throwable $e) {
    error_log('dang-bai oauth: ' . $e);
    back("Kết nối $name bị lỗi: " . $e->getMessage(), false);
}
