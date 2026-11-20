# Website Tết Chay An Lạc – Hòa Bình Xanh

Hội chợ Triển lãm Sản phẩm Chay, Xanh và Phát triển Bền vững **“Tết Chay An Lạc”** – chủ đề “Hòa Bình Xanh”
24 – 27/12/2026 · Công viên Hòa Bình, phường Xuân Đỉnh, Hà Nội.

## Cấu trúc

| File / thư mục | Vai trò |
|---|---|
| `index.html`, `styles.css`, `script.js` | Trang chủ |
| `site-data.js`, `modules.css` | Hiển thị dữ liệu từ trang quản trị (đơn vị tham gia, tin tức, lịch trình, tài trợ, liên hệ) |
| `khung-anh.html` | Công cụ ghép ảnh vào khung lễ hội |
| `admin.html`, `admin.js`, `admin.css` | Trang quản trị |
| `api.php` | Máy chủ cho trang quản trị và form đăng ký (cần PHP 7.4+) |
| `data/` | Dữ liệu công khai (JSON, logo, ảnh tin tức) |
| `data/private/` | Đăng ký của khách – **không** đưa lên GitHub, bị chặn truy cập bằng `.htaccess` |

## Nơi chạy

- **GitHub Pages:** xem website (chỉ đọc). Trang quản trị và form đăng ký **không** hoạt động vì GitHub Pages không chạy PHP.
- **Hostinger (hoặc hosting có PHP):** đầy đủ chức năng. Sau khi đưa code lên, tạo `api-config.php` từ `api-config.example.php` và đặt mật khẩu quản trị.
