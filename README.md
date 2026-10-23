# Website Tết Chay An Lạc 2027

Lễ hội **Tết Chay An Lạc 2027** – “Xuân An Lạc · Sống xanh · Gìn giữ hồn Việt”
09 – 13/01/2027 · Công viên Thống Nhất, Hà Nội.

## Cấu trúc

| File / thư mục | Vai trò |
|---|---|
| `index.html`, `styles.css`, `script.js` | Trang chủ |
| `site-data.js`, `modules.css` | Hiển thị dữ liệu từ trang quản trị (đơn vị tham gia, tin tức, lịch trình, tài trợ, liên hệ) |
| `khung-anh.html` | Công cụ ghép ảnh vào khung 2027 |
| `admin.html`, `admin.js`, `admin.css` | Trang quản trị |
| `api.php` | Máy chủ cho trang quản trị và form đăng ký (cần PHP 7.4+) |
| `data/` | Dữ liệu công khai (JSON, logo, ảnh tin tức) |
| `data/private/` | Đăng ký của khách – **không** đưa lên GitHub, bị chặn truy cập bằng `.htaccess` |

## Nơi chạy

- **GitHub Pages:** xem website (chỉ đọc). Trang quản trị và form đăng ký **không** hoạt động vì GitHub Pages không chạy PHP.
- **Hostinger (hoặc hosting có PHP):** đầy đủ chức năng. Sau khi đưa code lên, tạo `api-config.php` từ `api-config.example.php` và đặt mật khẩu quản trị.
