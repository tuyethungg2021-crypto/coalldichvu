Bản v19 sửa:
1. Highlands:
   - Thời gian chờ OTP mặc định 5 phút.
   - Khi khách mua, số trong kho chuyển sang trạng thái Giữ lại/đang chờ, chưa chốt bán.
   - Nếu có OTP: số chuyển sang Đã bán.
   - Nếu quá 5 phút chưa có OTP: tự hoàn tiền vào tài khoản khách và trả số về kho Trống.
   - Nếu một số trong kho không thuê lại được qua API: tự bỏ qua số đó, chuyển số đó sang Giữ lại/lỗi để admin kiểm tra, rồi thử số tiếp theo.
2. QR nạp tiền tự động:
   - Báo lỗi rõ nếu admin chưa cấu hình mã ngân hàng hoặc số tài khoản.
   - Thêm link mở QR trong tab mới.
   - Thêm URL QR dự phòng nếu ảnh QR chính không tải được.

Sau khi deploy:
- Vào Admin -> API thuê sim, kiểm tra Thời gian chờ OTP = 5 rồi bấm Lưu nếu đang là giá trị cũ.
- Vào Admin -> Nạp tiền admin, nhập đúng Mã ngân hàng VietQR, Số tài khoản, Tên chủ tài khoản rồi bấm Lưu.
- Ctrl + Shift + R để xoá cache trình duyệt.
