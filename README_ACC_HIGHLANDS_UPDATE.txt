BẢN SỬA THỰC SỰ - ACC HIGHLANDS

Đã sửa trực tiếp code:
1. server.js
- Tự tạo dịch vụ ACC Highlands khi server khởi động nếu chưa có.
- service_type = highlands, visible = 1, external_app_id mặc định = 1432.
- Sửa normalizePhoneNumber: API trả 812119032 sẽ được chuẩn hóa thành 0812119032 để khớp kho admin.
- Luồng Highlands thuê lại đúng số trong kho bằng tham số phone.
- Id trong response legacy được dùng làm external_id để check OTP, không còn báo nhầm do Number thiếu số 0 đầu.
- Thêm API /api/admin/highlands-orders để admin xem lịch sử ACC Highlands.
- Thêm API /api/admin/highlands-stock/bulk-delete để xóa nhiều số, xóa theo trạng thái, hoặc xóa toàn bộ kho của dịch vụ.

2. public/app.js và app.js
- Tab Kho Highlands có checkbox chọn nhiều số.
- Có nút Xóa đã chọn, Xóa theo trạng thái, Xóa toàn bộ kho đang chọn.
- Có bảng Lịch sử ACC Highlands.

Lưu ý sau deploy:
- Vào Render redeploy bản zip này.
- Đợi deploy Live.
- Mở web và bấm Ctrl + Shift + R.
- Nếu database MongoDB cũ đang có service trùng tên khác, service tự tạo chỉ tạo khi chưa có đúng tên ACC Highlands.
