BẢN SỬA CHO RENDER FREE

Bản này không còn phụ thuộc vào file data/app-data.json và thư mục uploads trên Render.
- Dữ liệu user, số dư, lịch sử, cấu hình... lưu vào MongoDB Atlas.
- Ảnh upload/chứng từ/QR/logo lưu vào Cloudinary.

Biến môi trường cần có trên Render:

MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/coalldichvu?retryWrites=true&w=majority
MONGODB_DB=coalldichvu
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
JWT_SECRET=chuoi_bi_mat_dai_kho_doan
ADMIN_USERNAME=hungnbyt
ADMIN_PASSWORD=mat_khau_admin_moi

Sau khi cập nhật code lên GitHub, vào Render bấm Manual Deploy / Deploy latest commit.
Mở /api/health, nếu thấy db="mongodb" và cloudinary=true là đã chạy đúng.

LƯU Ý BẢO MẬT:
Bạn đã từng để lộ MongoDB password và Cloudinary API Secret qua ảnh chat. Hãy đổi lại mật khẩu MongoDB user và regenerate Cloudinary API key/secret, rồi cập nhật lại trong Render.
