Bản fix Highlands:

1. Backend đã lưu được service_type = highlands khi thêm/sửa dịch vụ.
2. Khi admin chọn Loại = Highlands và bấm Lưu, reload lại sẽ không tự quay về Sim thường nữa.
3. Kho Highlands chỉ nhận dịch vụ có service_type = highlands.
4. Khách mua dịch vụ Highlands: web lấy số còn Trống trong kho admin, gọi API thuê lại đúng số đó, rồi chờ OTP như luồng thuê sim.

Cách dùng:
- Upload/deploy lại toàn bộ source này lên Render/GitHub.
- Vào Dịch vụ admin -> chọn Loại = Highlands cho dịch vụ cần dùng -> bấm Lưu.
- Vào Kho Highlands -> chọn dịch vụ -> paste danh sách số -> Nhập kho Highlands.
