Bản này đã tích hợp API chaycodeso3:
- Admin > API thuê sim: đổi API URL, đổi API key, test tài khoản, đồng bộ dịch vụ.
- Dịch vụ admin: có cột App ID API, giá API, giá bán cho user.
- User thuê sim: gọi API act=number thật.
- User bấm Lấy code: gọi API act=code.
- User bấm Hủy: gọi API act=expired.

Lưu ý bảo mật: API key lưu trong data/app-data.json trên server, user thường không xem được qua /api/settings.
Khi cập nhật code trên Render, giữ nguyên data/ và uploads/ hoặc gắn Persistent Disk để không mất dữ liệu.
