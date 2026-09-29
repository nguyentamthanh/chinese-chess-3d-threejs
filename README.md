# Co Tuong 3D (Three.js)

Demo cờ tướng 3D với đủ 32 quân và mô hình riêng cho:
- Tướng
- Sĩ
- Tượng
- Xe
- Pháo
- Mã
- Tốt

Tính năng:
- Chơi `1 người với máy` hoặc `2 người`.
- Đi quân theo luật cơ bản của cờ tướng (bao gồm ngựa cản chân, tượng cản mắt, pháo ăn qua màn, tướng đối mặt).
- Hiển thị nước đi hợp lệ khi chọn quân.

## Chạy nhanh

```bash
cd /mnt/c/Users/Admin/Desktop/co-tuong-3d-threejs
npm run dev
```

Hoặc:

```bash
cd /mnt/c/Users/Admin/Desktop/co-tuong-3d-threejs
python3 -m http.server 5173
```

Mở trình duyệt tại:

- http://localhost:5173

## Tương tác

- Kéo chuột trái: xoay camera
- Lăn chuột: zoom
- Click vào quân: chọn quân
- Click vào điểm đến hợp lệ: di chuyển quân
- Đổi mode ở dropdown và bấm `Ván mới` để reset

## Mô hình nhân vật

Quân **Mã** dùng `models/Horse.glb` và quân **Tốt** dùng `models/Soldier.glb` (lấy từ thư mục ví dụ của [three.js](https://github.com/mrdoob/three.js), giấy phép MIT; ngựa do mirada.com, lính từ Mixamo). Nếu không nạp được file, game tự dùng mô hình dựng bằng code.
