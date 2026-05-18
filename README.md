# Có All Dịch Vụ - Bản nhiều người dùng chung dữ liệu

Bản này khác bản HTML cũ: có **backend Node.js + SQLite database** nên nhiều người dùng có thể đăng nhập cùng một web và dùng chung dữ liệu.

## Tài khoản admin mặc định

- Tài khoản: `hungnbyt`
- Mật khẩu: `azhung12`

Sau khi chạy web thật, bạn nên đổi mật khẩu admin trong giao diện admin hoặc đổi biến môi trường.

## Dữ liệu được lưu ở đâu?

- Database: `data/app.db`
- Ảnh QR/logo/quảng cáo/bill: thư mục `uploads/`

Muốn cập nhật code mà giữ nguyên user, số dư, lịch sử thuê, nạp tiền:

1. **Không xóa thư mục `data/`**
2. **Không xóa thư mục `uploads/`**
3. Chỉ thay các file code như `server.js`, `public/app.js`, `public/styles.css`, `public/index.html`

File `.gitignore` đã chặn không đưa database lên GitHub để tránh lộ dữ liệu người dùng.

## Chạy trên máy tính

Cài Node.js trước, sau đó mở terminal trong thư mục web và chạy:

```bash
npm install
npm start
```

Mở trình duyệt vào:

```text
http://localhost:3000
```

## Deploy để nhiều người dùng chung dữ liệu

GitHub Pages **không chạy được backend/database**, nên bản nhiều người dùng này không thể chạy hoàn chỉnh trên GitHub Pages.

Bạn có thể up code lên GitHub, sau đó deploy lên một nền tảng chạy Node.js như:

- Render
- Railway
- VPS riêng
- Koyeb
- Fly.io

Khi deploy nhớ đặt biến môi trường:

```text
PORT=3000
JWT_SECRET=tao_chuoi_bi_mat_dai_va_kho_doan
ADMIN_USERNAME=hungnbyt
ADMIN_PASSWORD=azhung12
```

Lưu ý với host miễn phí: nếu host xóa ổ đĩa khi restart thì database có thể mất. Muốn lưu vĩnh viễn, nên dùng VPS hoặc dịch vụ có persistent disk/volume.

## Chức năng đã có

### Người dùng

- Đăng ký, đăng nhập
- Thuê sim theo dịch vụ/nhà mạng
- Xem sim đang thuê
- Xem lịch sử thuê
- Thuê lại
- Gửi yêu cầu nạp tiền
- Upload ảnh bill/chứng từ nạp
- Xem trạng thái yêu cầu nạp

### Admin

- Đăng nhập admin
- Thêm/sửa/xóa dịch vụ thuê sim
- Ẩn/hiện dịch vụ
- Thay đổi giá dịch vụ
- Xem toàn bộ lịch sử thuê của user
- Cập nhật trạng thái/OTP lượt thuê
- Sửa thông tin nhận tiền nạp
- Upload QR nạp tiền
- Duyệt/từ chối nạp tiền
- Khi duyệt nạp, tiền tự cộng vào tài khoản user
- Quản lý user
- Tăng/giảm/sửa số dư user
- Đổi mật khẩu user
- Xóa user
- Hiển thị số ngày user chưa truy cập web
- Đổi tên web, màu giao diện, bố cục
- Upload logo/thương hiệu/quảng cáo
- Nhận thông báo khi user gửi yêu cầu nạp tiền

## Cập nhật phiên bản sau này mà không mất dữ liệu

Khi có bản code mới:

1. Tải code mới về
2. Copy thư mục `data/` từ bản cũ sang bản mới
3. Copy thư mục `uploads/` từ bản cũ sang bản mới
4. Chạy lại `npm install` nếu có thay đổi package
5. Chạy `npm start`

Server có phần migration an toàn: nếu sau này thêm cột/bảng mới, app sẽ tự tạo thêm mà không xóa dữ liệu cũ.

## Ghi chú quan trọng

Đây là bản nền tảng để bạn chạy thật. Nếu kinh doanh lớn, nên nâng cấp thêm:

- Kết nối API thuê sim thật từ nhà cung cấp
- Thanh toán tự động qua ngân hàng/payment gateway
- Bảo mật nâng cao, chống spam, giới hạn request
- Backup database định kỳ
- HTTPS và domain riêng
