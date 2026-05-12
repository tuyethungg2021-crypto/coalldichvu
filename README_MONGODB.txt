HUONG DAN LUU DATA VINH VIEN BANG MONGODB ATLAS

1. Vao https://cloud.mongodb.com/ dang ky/dang nhap.
2. Tao Project moi -> Build a Database -> chon Free M0.
3. Tao Database User:
   - Username: tu dat
   - Password: tu dat, khong dung dau cach.
4. Network Access -> Add IP Address -> Allow Access From Anywhere: 0.0.0.0/0.
5. Database -> Connect -> Drivers -> copy connection string dang:
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
6. Vao Render -> service web -> Environment -> Add Environment Variable:
   MONGODB_URI = chuoi vua copy, thay USER/PASSWORD bang tai khoan MongoDB
   MONGODB_DB = co_all_dich_vu
   JWT_SECRET = mot_chuoi_bi_mat_dai_bat_ky
7. Render -> Manual Deploy -> Clear build cache & deploy.

Sau khi dung MongoDB:
- Update code khong mat user, so du, lich su, dich vu, setting web.
- Anh upload/logo/QR trong ban nay duoc luu thanh data URL trong MongoDB, nen khong can Persistent Disk cho uploads.
- Neu truoc do da co data trong JSON cu tren Render, can export/import thu cong. Neu chua co user that thi chi can deploy ban nay.
