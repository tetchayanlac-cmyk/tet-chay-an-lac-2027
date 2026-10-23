<?php
// API cho trang quản trị Tết Chay An Lạc 2027 (chạy trên Hostinger, PHP 7.4+).
// Dữ liệu công khai: data/content.json, data/tin-tuc.json, data/don-vi.json, data/logos/, data/tin-tuc/
// Dữ liệu riêng tư (chặn bằng .htaccess): data/private/dang-ky.json, data/private/backups/
declare(strict_types=1);
// api-config.php không nằm trong GitHub (chứa mật khẩu). Thiếu file → khóa trang quản trị.
if (is_file(__DIR__ . '/api-config.php')) require __DIR__ . '/api-config.php';
if (!defined('ADMIN_PASSWORD')) define('ADMIN_PASSWORD', '');

date_default_timezone_set('Asia/Ho_Chi_Minh');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const DATA = __DIR__ . '/data';
const PRIV = DATA . '/private';
const REGS = PRIV . '/dang-ky.json';
const SAVE_FILES = ['content' => 'content.json', 'news' => 'tin-tuc.json', 'units' => 'don-vi.json'];
const UPLOAD_DIRS = ['logos' => 'logos', 'news' => 'tin-tuc'];
const NAME_RE = '/^[a-z0-9][a-z0-9-]{0,80}\.(webp|png|jpg)$/';
const STATUSES = ['moi', 'da-lien-he', 'hoan-tat', 'huy'];
const JSON_OUT = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT;

function out(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}
function body(int $max): string {
  $b = file_get_contents('php://input', false, null, 0, $max + 1);
  if ($b === false) out(400, ['error' => 'Không đọc được dữ liệu gửi lên']);
  if (strlen($b) > $max) out(413, ['error' => 'Dữ liệu quá lớn']);
  return $b;
}
function requireMethod(string $m): void {
  if ($_SERVER['REQUEST_METHOD'] !== $m) out(405, ['error' => 'Sai phương thức']);
}
function requireAdmin(): void {
  $key = (string)($_SERVER['HTTP_X_ADMIN_KEY'] ?? '');
  if (ADMIN_PASSWORD === '' || !hash_equals(ADMIN_PASSWORD, $key)) {
    usleep(600000);
    out(401, ['error' => 'Sai mật khẩu']);
  }
}
function writeAtomic(string $file, string $data): void {
  $tmp = $file . '.tmp' . bin2hex(random_bytes(4));
  if (file_put_contents($tmp, $data, LOCK_EX) === false || !rename($tmp, $file)) {
    @unlink($tmp);
    out(500, ['error' => 'Không ghi được file. Kiểm tra quyền ghi của thư mục data/.']);
  }
}
function backup(string $file, string $key): void {
  if (!is_file($file)) return;
  $dir = PRIV . '/backups';
  if (!is_dir($dir)) mkdir($dir, 0755, true);
  copy($file, "$dir/$key-" . date('Ymd-His') . '.json');
  $all = glob("$dir/$key-*.json") ?: [];
  rsort($all);
  foreach (array_slice($all, 50) as $old) @unlink($old);
}
// Đọc - sửa - ghi danh sách đăng ký trong một khóa file để không mất đăng ký mới.
function withRegs(callable $fn) {
  $fp = fopen(REGS, 'c+');
  if (!$fp) out(500, ['error' => 'Không mở được file đăng ký']);
  flock($fp, LOCK_EX);
  $list = json_decode(stream_get_contents($fp) ?: '[]', true);
  if (!is_array($list)) $list = [];
  [$list, $result] = $fn($list);
  if ($list !== null) {
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode(array_values($list), JSON_OUT));
    fflush($fp);
  }
  flock($fp, LOCK_UN);
  fclose($fp);
  return $result;
}
function rateLimited(string $ip): bool {
  $file = PRIV . '/rate.json';
  $now = time();
  $data = is_file($file) ? (json_decode((string)file_get_contents($file), true) ?: []) : [];
  foreach ($data as $k => $times) {
    $data[$k] = array_values(array_filter($times, function ($t) use ($now) { return $t > $now - 600; }));
    if (!$data[$k]) unset($data[$k]);
  }
  $key = hash('sha256', $ip);
  $hit = count($data[$key] ?? []) >= 5;
  if (!$hit) $data[$key][] = $now;
  file_put_contents($file, json_encode($data), LOCK_EX);
  return $hit;
}

foreach ([DATA, PRIV, DATA . '/logos', DATA . '/tin-tuc'] as $d) {
  if (!is_dir($d)) mkdir($d, 0755, true);
}
if (!is_file(PRIV . '/.htaccess')) {
  file_put_contents(PRIV . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
}

$action = (string)($_GET['action'] ?? '');

switch ($action) {
  // ---------- Công khai: gửi đăng ký ----------
  case 'register':
    requireMethod('POST');
    $in = json_decode(body(20000), true);
    if (!is_array($in)) out(400, ['error' => 'Dữ liệu không hợp lệ']);
    if (!empty($in['website'])) out(200, ['ok' => true]); // bẫy bot
    $content = json_decode((string)@file_get_contents(DATA . '/content.json'), true) ?: [];
    if (isset($content['dangKyMo']) && $content['dangKyMo'] === false) out(403, ['error' => 'Cổng đăng ký đã đóng']);
    $s = function (string $k, int $n) use ($in): string { return mb_substr(trim((string)($in[$k] ?? '')), 0, $n); };
    $reg = [
      'id' => bin2hex(random_bytes(6)),
      'thoiGian' => date('c'),
      'hoTen' => $s('name', 120),
      'dienThoai' => $s('phone', 30),
      'email' => $s('email', 120),
      'quanTam' => $s('interest', 40),
      'loiNhan' => $s('message', 2000),
      'trangThai' => 'moi',
      'ghiChu' => '',
    ];
    if ($reg['hoTen'] === '' || !preg_match('/^[0-9 +.]{9,15}$/', $reg['dienThoai'])) {
      out(400, ['error' => 'Vui lòng nhập họ tên và số điện thoại hợp lệ']);
    }
    if (rateLimited((string)($_SERVER['REMOTE_ADDR'] ?? ''))) out(429, ['error' => 'Bạn gửi quá nhiều lần, vui lòng thử lại sau ít phút']);
    withRegs(function ($list) use ($reg) { $list[] = $reg; return [$list, null]; });
    out(200, ['ok' => true]);

  // ---------- Quản trị ----------
  case 'login':
    requireAdmin();
    out(200, ['ok' => true]);

  case 'save':
    requireMethod('POST');
    requireAdmin();
    $key = (string)($_GET['file'] ?? '');
    if (!isset(SAVE_FILES[$key])) out(400, ['error' => 'Không rõ loại dữ liệu']);
    $data = json_decode(body(10000000));
    if (json_last_error() !== JSON_ERROR_NONE) out(400, ['error' => 'Dữ liệu JSON lỗi']);
    if ($key === 'content' ? !is_object($data) : !is_array($data)) out(400, ['error' => 'Sai cấu trúc dữ liệu']);
    $file = DATA . '/' . SAVE_FILES[$key];
    backup($file, $key);
    writeAtomic($file, json_encode($data, JSON_OUT));
    out(200, ['ok' => true]);

  case 'upload':
    requireMethod('POST');
    requireAdmin();
    $dir = UPLOAD_DIRS[(string)($_GET['folder'] ?? '')] ?? null;
    $name = (string)($_GET['name'] ?? '');
    if (!$dir || !preg_match(NAME_RE, $name)) out(400, ['error' => 'Tên file không hợp lệ']);
    $bytes = body(3000000);
    $info = @getimagesizefromstring($bytes);
    if (!$info || !in_array($info['mime'], ['image/webp', 'image/png', 'image/jpeg'], true)) out(400, ['error' => 'File không phải ảnh hợp lệ']);
    writeAtomic(DATA . "/$dir/$name", $bytes);
    out(200, ['ok' => true]);

  case 'delete-file':
    requireMethod('POST');
    requireAdmin();
    $dir = UPLOAD_DIRS[(string)($_GET['folder'] ?? '')] ?? null;
    $name = (string)($_GET['name'] ?? '');
    if (!$dir || !preg_match(NAME_RE, $name)) out(400, ['error' => 'Tên file không hợp lệ']);
    @unlink(DATA . "/$dir/$name");
    out(200, ['ok' => true]);

  case 'registrations':
    requireAdmin();
    $list = is_file(REGS) ? (json_decode((string)file_get_contents(REGS), true) ?: []) : [];
    out(200, ['items' => $list]);

  case 'registration-update':
    requireMethod('POST');
    requireAdmin();
    $in = json_decode(body(20000), true);
    if (!is_array($in) || empty($in['id'])) out(400, ['error' => 'Thiếu mã đăng ký']);
    $found = withRegs(function ($list) use ($in) {
      foreach ($list as $i => $r) {
        if (($r['id'] ?? '') !== $in['id']) continue;
        if (!empty($in['xoa'])) { unset($list[$i]); return [$list, true]; }
        if (isset($in['trangThai']) && in_array($in['trangThai'], STATUSES, true)) $list[$i]['trangThai'] = $in['trangThai'];
        if (isset($in['ghiChu'])) $list[$i]['ghiChu'] = mb_substr((string)$in['ghiChu'], 0, 1000);
        return [$list, true];
      }
      return [null, false];
    });
    if (!$found) out(404, ['error' => 'Không tìm thấy đăng ký']);
    out(200, ['ok' => true]);

  default:
    out(404, ['error' => 'Không có chức năng này']);
}
