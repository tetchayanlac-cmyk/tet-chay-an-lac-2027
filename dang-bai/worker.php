<?php
// Module "Đăng bài MXH" – tiến trình đăng bài theo lịch. Chạy mỗi phút bằng cron:
//   docker exec -u www-data tetchayanlac-web php /var/www/html/dang-bai/worker.php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/platforms.php';
set_time_limit(0);
ini_set('memory_limit', '512M');

$lock = fopen(KHO . '/worker.lock', 'c');
if (!flock($lock, LOCK_EX | LOCK_NB)) exit(0); // lần chạy trước chưa xong (đang tải video lớn)

$now = time();
$posts = q("SELECT * FROM posts WHERE status IN ('approved','publishing') AND (scheduled IS NULL OR scheduled <= ?) ORDER BY COALESCE(scheduled,0), id", [$now])->fetchAll();
foreach ($posts as $p) {
    $id = (int)$p['id'];
    if ($p['status'] === 'approved') {
        q("UPDATE posts SET status='publishing', updated=? WHERE id=?", [time(), $id]);
        nhat_ky(null, 'bat-dau-dang', "#$id");
    }
    $results = q("SELECT * FROM results WHERE post=? AND status IN ('waiting','processing')", [$id])->fetchAll();
    foreach ($results as $r) {
        try {
            $o = publish_step($p, $r);
        } catch (Throwable $e) {
            $o = ['status' => 'failed', 'remote' => '', 'url' => '', 'error' => $e->getMessage(), 'state' => json_decode($r['state'] ?: '{}', true) ?: []];
        }
        q('UPDATE results SET status=?, remote=?, url=?, error=?, state=?, updated=? WHERE id=?', [
            $o['status'], (string)$o['remote'], (string)$o['url'], mb_substr((string)$o['error'], 0, 1000),
            json_encode($o['state'] ?: new stdClass()), time(), $r['id'],
        ]);
        if ($o['status'] !== 'processing') {
            nhat_ky(null, $o['status'] === 'done' ? 'da-dang' : 'loi-dang', "#$id {$r['platform']} " . ($o['url'] ?: $o['error']));
        }
        echo date('c') . " #$id {$r['platform']}: {$o['status']} {$o['url']}{$o['error']}\n";
    }
    finalize_post($id);
}

// Dọn tệp tải lên dở hoặc tải lên rồi bỏ (không thuộc bài nào) sau 2 ngày
if ((int)date('i') === 7) {
    foreach (glob(MEDIA_DIR . '/*.{mp4,mov,jpg}', GLOB_BRACE) ?: [] as $f) {
        if (filemtime($f) < time() - 172800 && !media_in_use(basename($f))) @unlink($f);
    }
    foreach (glob(TAM_DIR . '/*.part') ?: [] as $f) {
        if (filemtime($f) < time() - 86400) @unlink($f);
    }
}
