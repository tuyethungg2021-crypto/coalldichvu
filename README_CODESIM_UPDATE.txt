Bản cập nhật CodeSim API

- Tích hợp API CodeSim theo tài liệu:
  + /yourself/information-by-api-key
  + /service/get_service_by_api_key
  + /sim/get_sim
  + /otp/get_otp_by_phone_api_key
  + /sim/cancel_api_key/{sim_id}
- Vẫn giữ trang Admin - API thuê sim để đổi API URL/API key/thời gian chờ OTP.
- Dịch vụ đồng bộ từ API mặc định visible = 0 / ẩn. Admin cần bật từng dịch vụ trong Dịch vụ admin.
- User không được hủy sim đang thuê.
- Hết thời gian chờ OTP và chưa nhận code sẽ tự hoàn tiền khi user/admin mở lịch sử hoặc bấm lấy code.
- Upload ảnh logo/quảng cáo/QR/sản phẩm vẫn đi qua backend /api/upload.

Gợi ý cấu hình Admin - API thuê sim:
API URL: https://apisim.codesim.net
Nhà cung cấp: CodeSim
Thời gian chờ OTP: 20 phút hoặc tùy bạn.
