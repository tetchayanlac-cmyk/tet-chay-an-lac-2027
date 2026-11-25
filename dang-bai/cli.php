<?php
// Module "Đăng bài MXH" – lệnh quản lý trên máy chủ (không chạy qua web)
//   U=ten P=matkhau N="Tên hiển thị" php cli.php tao-quan-tri
//   php cli.php base-url https://tetchayanlac.com/dang-bai
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib.php';

$cmd = $argv[1] ?? '';
if ($cmd === 'tao-quan-tri') {
    $u = strtolower(trim((string)getenv('U')));
    $p = (string)getenv('P');
    $n = trim((string)getenv('N')) ?: $u;
    if (!preg_match('/^[a-z0-9._-]{3,32}$/', $u)) { fwrite(STDERR, "Tên đăng nhập 3–32 ký tự: chữ thường không dấu, số, dấu chấm, gạch.\n"); exit(1); }
    if (mb_strlen($p) < 8) { fwrite(STDERR, "Mật khẩu cần ít nhất 8 ký tự.\n"); exit(1); }
    $h = password_hash($p, PASSWORD_DEFAULT);
    if (q('SELECT 1 FROM users WHERE username=?', [$u])->fetchColumn()) {
        q("UPDATE users SET pass=?, role='admin', active=1, name=? WHERE username=?", [$h, $n, $u]);
        echo "Đã đặt lại mật khẩu và quyền quản trị cho \"$u\".\n";
    } else {
        q("INSERT INTO users(username,name,pass,role,active,created) VALUES(?,?,?,'admin',1,?)", [$u, $n, $h, time()]);
        echo "Đã tạo tài khoản quản trị \"$u\".\n";
    }
    nhat_ky(null, 'tao-quan-tri', $u);
    exit(0);
}
if ($cmd === 'base-url' && !empty($argv[2])) {
    cfg_set('base_url', rtrim($argv[2], '/'));
    echo "Đã đặt địa chỉ gốc: " . base_url() . "\n";
    exit(0);
}
if ($cmd === 'xoa-tai-khoan' && !empty($argv[2])) {
    q('DELETE FROM users WHERE username=?', [strtolower($argv[2])]);
    echo "Đã xóa (nếu có).\n";
    exit(0);
}
fwrite(STDERR, "Lệnh: tao-quan-tri | base-url <url> | xoa-tai-khoan <ten>\n");
exit(1);
