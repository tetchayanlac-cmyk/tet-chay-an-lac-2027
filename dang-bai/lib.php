<?php
// Module "Đăng bài MXH" – thư viện chung (CSDL, cấu hình, phiên đăng nhập, HTTP)
declare(strict_types=1);
date_default_timezone_set('Asia/Ho_Chi_Minh');

const KHO = __DIR__ . '/kho';               // dữ liệu riêng: CSDL, phiên, tệp tạm (cấm truy cập web)
const MEDIA_DIR = KHO . '/media';           // video/ảnh đã tải lên (tên ngẫu nhiên, để MXH tải về)
const TAM_DIR = KHO . '/tam';
const PLATFORMS = ['facebook' => 'Facebook', 'instagram' => 'Instagram', 'youtube' => 'YouTube', 'tiktok' => 'TikTok'];
const MAX_UPLOAD = 2147483648;              // 2 GB
const MEDIA_TYPES = ['video/mp4' => 'mp4', 'video/quicktime' => 'mov', 'image/jpeg' => 'jpg'];

class UserError extends RuntimeException {}

function kho_init(): void
{
    foreach ([KHO, MEDIA_DIR, TAM_DIR, KHO . '/phien'] as $d) {
        if (!is_dir($d)) @mkdir($d, 0775, true);
    }
    if (!is_file(KHO . '/.htaccess')) {
        file_put_contents(KHO . '/.htaccess', "Require all denied\n");
    }
    if (!is_file(MEDIA_DIR . '/.htaccess')) {
        file_put_contents(MEDIA_DIR . '/.htaccess', "Require all granted\nOptions -Indexes\n"
            . "<FilesMatch \"\\.(php|phtml|phar|htaccess|sqlite)\">\n  Require all denied\n</FilesMatch>\n"
            . "<IfModule mod_headers.c>\n  Header set X-Robots-Tag \"noindex, nofollow\"\n  Header set X-Content-Type-Options \"nosniff\"\n</IfModule>\n");
    }
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    kho_init();
    $pdo = new PDO('sqlite:' . KHO . '/dang-bai.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout=10000');
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
  pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY, author INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '',
  media TEXT NOT NULL DEFAULT '', media_type TEXT NOT NULL DEFAULT '', media_size INTEGER NOT NULL DEFAULT 0,
  media_name TEXT NOT NULL DEFAULT '', platforms TEXT NOT NULL DEFAULT '[]', scheduled INTEGER,
  status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '', reviewer INTEGER, reviewed INTEGER,
  created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS results(
  id INTEGER PRIMARY KEY, post INTEGER NOT NULL, platform TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
  remote TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '{}', updated INTEGER NOT NULL, UNIQUE(post, platform));
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS logins(ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, user INTEGER, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
SQL);
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement
{
    $s = db()->prepare($sql);
    $s->execute($args);
    return $s;
}

function cfg(string $k, $def = null)
{
    $v = q('SELECT v FROM settings WHERE k=?', [$k])->fetchColumn();
    return $v === false ? $def : json_decode($v, true);
}

function cfg_set(string $k, $v): void
{
    if ($v === null) {
        q('DELETE FROM settings WHERE k=?', [$k]);
        return;
    }
    q('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',
        [$k, json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
}

function base_url(): string
{
    return rtrim((string)cfg('base_url', 'https://tetchayanlac.com/dang-bai'), '/');
}

function media_url(string $file): string
{
    return base_url() . '/kho/media/' . rawurlencode($file);
}

function nhat_ky(?int $uid, string $action, string $detail = ''): void
{
    q('INSERT INTO log(ts,user,action,detail) VALUES(?,?,?,?)', [time(), $uid, $action, mb_substr($detail, 0, 1000)]);
}

/* ---------- Phiên đăng nhập ---------- */

function start_session(): void
{
    kho_init();
    $https = (($_SERVER['HTTPS'] ?? '') === 'on') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    ini_set('session.save_path', KHO . '/phien');
    ini_set('session.gc_maxlifetime', '43200');
    ini_set('session.use_strict_mode', '1');
    session_name('DANGBAI');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/dang-bai/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
}

function current_user(): ?array
{
    if (empty($_SESSION['uid'])) return null;
    $u = q('SELECT id,username,name,role,active FROM users WHERE id=?', [$_SESSION['uid']])->fetch();
    if (!$u || !(int)$u['active']) return null;
    $u['id'] = (int)$u['id'];
    return $u;
}

function client_ip(): string
{
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($xff !== '') {
        $parts = array_map('trim', explode(',', $xff));
        return (string)end($parts);
    }
    return (string)($_SERVER['REMOTE_ADDR'] ?? '');
}

/* ---------- HTTP ---------- */

function http(string $method, string $url, array $o = []): array
{
    $ch = curl_init();
    $headers = $o['headers'] ?? [];
    $rh = [];
    $fp = null;
    $opts = [
        CURLOPT_URL => $url,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $o['timeout'] ?? 120,
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$rh) {
            $p = strpos($line, ':');
            if ($p) $rh[strtolower(trim(substr($line, 0, $p)))] = trim(substr($line, $p + 1));
            return strlen($line);
        },
    ];
    if (isset($o['form'])) {
        $opts[CURLOPT_POSTFIELDS] = http_build_query($o['form']);
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    } elseif (array_key_exists('json', $o)) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($o['json'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $headers[] = 'Content-Type: application/json; charset=UTF-8';
    } elseif (isset($o['body'])) {
        $opts[CURLOPT_POSTFIELDS] = $o['body'];
    } elseif (isset($o['file'])) {
        $fp = fopen($o['file'], 'rb');
        $opts[CURLOPT_UPLOAD] = true;
        $opts[CURLOPT_INFILE] = $fp;
        $opts[CURLOPT_INFILESIZE] = filesize($o['file']);
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $err = curl_error($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($fp) fclose($fp);
    if ($body === false) throw new RuntimeException('Lỗi kết nối mạng: ' . $err);
    return ['code' => $code, 'body' => $body, 'json' => json_decode((string)$body, true), 'headers' => $rh];
}

/* ---------- Bài đăng ---------- */

function post_platforms(array $p): array
{
    $a = json_decode($p['platforms'] ?: '[]', true);
    return is_array($a) ? array_values(array_intersect(array_keys(PLATFORMS), $a)) : [];
}

/** Kiểm tra bài có đủ điều kiện đăng lên các nền tảng đã chọn. Trả về danh sách lỗi. */
function post_problems(array $p): array
{
    $err = [];
    $pl = post_platforms($p);
    $mt = $p['media_type'] ?? '';
    if (!$pl) $err[] = 'Chưa chọn nền tảng nào.';
    foreach ($pl as $k) {
        if (($k === 'youtube' || $k === 'tiktok') && $mt !== 'video') $err[] = PLATFORMS[$k] . ' chỉ nhận video.';
        if ($k === 'instagram' && $mt === '') $err[] = 'Instagram cần có video hoặc ảnh.';
        if ($k === 'facebook' && $mt === '' && trim((string)$p['caption']) === '') $err[] = 'Bài Facebook không có ảnh/video thì cần có nội dung.';
    }
    if (in_array('instagram', $pl, true) || in_array('tiktok', $pl, true)) {
        if (mb_strlen((string)$p['caption']) > 2200) $err[] = 'Instagram/TikTok giới hạn nội dung 2.200 ký tự.';
    }
    return $err;
}

/** Tạo lại danh sách kết quả "chờ đăng" cho từng nền tảng (khi duyệt). */
function reset_results(int $postId, array $platforms): void
{
    q("DELETE FROM results WHERE post=?", [$postId]);
    foreach ($platforms as $k) {
        q('INSERT INTO results(post,platform,status,updated) VALUES(?,?,?,?)', [$postId, $k, 'waiting', time()]);
    }
}

/** Cập nhật trạng thái tổng của bài theo kết quả từng nền tảng. */
function finalize_post(int $postId): string
{
    $rs = q('SELECT status FROM results WHERE post=?', [$postId])->fetchAll(PDO::FETCH_COLUMN);
    if (!$rs) return '';
    if (array_intersect($rs, ['waiting', 'processing'])) return 'publishing';
    $done = count(array_filter($rs, fn($s) => $s === 'done'));
    $st = $done === count($rs) ? 'done' : ($done === 0 ? 'failed' : 'partial');
    q('UPDATE posts SET status=?, updated=? WHERE id=?', [$st, time(), $postId]);
    return $st;
}

function media_in_use(string $file, int $exceptPost = 0): bool
{
    return (bool)q('SELECT 1 FROM posts WHERE media=? AND id<>? LIMIT 1', [$file, $exceptPost])->fetchColumn();
}

function delete_media(string $file, int $exceptPost = 0): void
{
    if ($file !== '' && preg_match('/^[a-f0-9]{32}\.(mp4|mov|jpg)$/', $file) && !media_in_use($file, $exceptPost)) {
        @unlink(MEDIA_DIR . '/' . $file);
    }
}
