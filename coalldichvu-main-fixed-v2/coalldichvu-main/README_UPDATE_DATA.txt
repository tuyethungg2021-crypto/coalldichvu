CACH UPDATE CODE KHONG MAT DU LIEU

Du lieu web nam trong:
- data/app-data.json
- uploads/

Khi cap nhat code len GitHub/Render:
1. Khong xoa Persistent Disk tren Render.
2. Khong upload de file data/app-data.json neu ban da co du lieu that tren server.
3. Chi upload/cap nhat cac file code: server.js, package.json, public/*.
4. Neu dung Render Free khong co Persistent Disk, moi lan rebuild/restart co the mat data. Muon giu vinh vien can gan Persistent Disk hoac dung VPS.

Trong ban nay, code khong tu reset cai dat admin da luu. Neu bi ve mac dinh thi nguyen nhan la server mat file data/app-data.json hoac chua gan disk dung mount path.
