# Hướng dẫn: lưu ảnh upload lên Cloudflare (R2)

Làm xong 6 bước dưới đây, ảnh upload từ máy tính (và ảnh tải về từ trang Crawling) sẽ được lưu trên **Cloudflare R2** và hiện ra cho mọi người xem.

> **R2 là gì?** Một "ổ cứng trên mạng" của Cloudflare. Mỗi tháng miễn phí 10 GB lưu trữ và không tính tiền băng thông tải ảnh ra. Cloudflare có thể yêu cầu thêm thẻ thanh toán khi bật R2 (không bị trừ tiền nếu dùng trong mức miễn phí). Xem giá hiện tại ở trang giá của Cloudflare R2.

Các tên menu của Cloudflare đôi khi đổi chữ một chút. Nếu không thấy đúng tên, tìm chỗ gần giống.

---

## Bước 1. Tạo "thùng đựng ảnh" (bucket)

1. Vào <https://dash.cloudflare.com> và đăng nhập (chưa có tài khoản thì đăng ký, miễn phí).
2. Ở menu bên trái bấm **R2 Object Storage** (có thể nằm trong nhóm *Storage & databases*). Nếu được hỏi bật R2, làm theo màn hình.
3. Bấm **Create bucket**.
4. Đặt tên, ví dụ: `picweb-photos` (chỉ dùng chữ thường, số và dấu gạch ngang). **Ghi lại tên này.**
5. Bấm **Create bucket**.

## Bước 2. Lấy "Account ID"

Vẫn ở trang **R2 Object Storage** (trang chính, không phải bên trong bucket), nhìn khung bên phải có dòng **Account ID** (32 ký tự). Bấm nút copy và dán tạm vào một chỗ. **Ghi lại số này.**

## Bước 3. Cho khách được xem ảnh

1. Bấm vào bucket vừa tạo, chọn tab **Settings**.
2. Tìm mục **Public Development URL**, bấm **Enable**.
3. Cloudflare bắt gõ chữ `allow`, gõ vào rồi bấm **Allow Access**.
4. Copy địa chỉ hiện ra, dạng `https://pub-0123abcd....r2.dev`. **Ghi lại địa chỉ này.**

> Địa chỉ `r2.dev` chỉ để **thử** (Cloudflare giới hạn tốc độ). Khi chạy thật, xem phần "Khi chạy thật" ở cuối.

## Bước 4. Tạo "chìa khóa" để máy chủ được ghi ảnh

1. Quay lại trang **R2 Object Storage**, bấm **API Tokens** (hoặc **Manage API Tokens**).
2. Bấm **Create API token**.
3. Đặt tên: `picweb`.
4. Ở **Permissions** chọn **Object Read & Write**.
5. Ở phần bucket chọn **Apply to specific buckets only** và chọn đúng bucket của bạn.
6. Bấm **Create API Token**.
7. Màn hình hiện hai giá trị: **Access Key ID** và **Secret Access Key**. **Secret chỉ hiện MỘT LẦN**: copy cả hai ngay. **Ghi lại.**

⚠️ Hai giá trị này như mật khẩu. Không gửi cho ai, không dán vào chat/email, không đưa lên GitHub.

## Bước 5. Điền vào file `.env`

1. Trong thư mục dự án (cùng chỗ với file `package.json`), tạo một file tên đúng là **`.env`** (có dấu chấm ở đầu, không có đuôi).
2. Dán nội dung sau vào và thay phần sau dấu `=` bằng các giá trị bạn đã ghi lại:

```
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=dán-Account-ID-vào-đây
R2_ACCESS_KEY_ID=dán-Access-Key-ID-vào-đây
R2_SECRET_ACCESS_KEY=dán-Secret-Access-Key-vào-đây
R2_BUCKET=picweb-photos
R2_PUBLIC_URL=https://pub-0123abcd.r2.dev
```

3. Lưu file.

File `.env` đã được dự án tự bỏ qua khi đưa lên git, nên không bị lộ lên GitHub. Vẫn đừng gửi nó cho người khác.

## Bước 6. Kiểm tra (chỉ cần chạy một lệnh)

Mở terminal trong thư mục dự án và chạy:

```
npm run check-storage
```

Lệnh này tự thử tải một ảnh nhỏ lên Cloudflare, mở nó ra như khách, rồi xóa. Kết quả:

- Thấy **🎉 Mọi thứ hoạt động** là xong.
- Thấy **❌** thì đọc dòng **👉** ngay bên dưới, nó nói chính xác cần sửa gì trong file `.env`. Sửa xong chạy lại lệnh.

Cuối cùng **khởi động lại máy chủ** (để nó đọc file `.env` mới):

```
npx astro dev stop
npx astro dev --background
```

Vào **Admin → Create new album → Upload from device**, chọn vài ảnh rồi tạo album. Ảnh sẽ xuất hiện trong bucket (Cloudflare → R2 → bucket → **Objects**).

---

## Lỗi hay gặp

| Thấy gì | Nghĩa là | Cách sửa |
| :--- | :--- | :--- |
| `Thiếu R2_...` | Chưa điền một giá trị trong `.env` | Điền giá trị đó (lệnh nói lấy ở đâu) |
| Cloudflare từ chối | Sai Access Key / Secret, hoặc token thiếu quyền | Tạo lại token ở Bước 4 với **Object Read & Write** cho đúng bucket |
| Không thấy bucket | Sai tên bucket | Sửa `R2_BUCKET` đúng chính tả |
| Không nối được tới Cloudflare | Sai Account ID, hoặc mất mạng | Copy lại Account ID ở Bước 2 |
| Địa chỉ công khai trả về 401/403/404 | Chưa bật xem công khai, hoặc sai `R2_PUBLIC_URL` | Làm lại Bước 3 và copy lại địa chỉ |
| Trên trang báo "photo storage is not set up" | Máy chủ chưa đọc `.env` | Khởi động lại máy chủ |

## Khi chạy thật (website cho nhiều người dùng)

1. **Gắn tên miền riêng cho bucket** thay cho `r2.dev`: vào bucket → **Settings → Custom Domains → Add**, nhập một tên miền con thuộc tài khoản Cloudflare của bạn (ví dụ `img.tenmiencuaban.com`). Rồi sửa trong `.env`: `R2_PUBLIC_URL=https://img.tenmiencuaban.com`. Tên miền riêng không bị giới hạn tốc độ như `r2.dev` và ảnh được lưu đệm (cache) nhanh hơn.
2. Trên máy chủ thật, đặt các giá trị này bằng cách nơi triển khai cung cấp (biến môi trường / secret) nếu có, thay vì để file `.env` nằm trên ổ đĩa.
3. Nếu nghi ngờ lộ chìa khóa: vào Cloudflare → R2 → **API Tokens**, xóa token cũ, tạo token mới (Bước 4) và cập nhật `.env`.
4. Bảo mật: đây là cấu hình có quyền ghi dữ liệu và công khai nội dung nên cần người phụ trách bảo mật của TECHVIFY xem lại trước khi dùng cho dữ liệu của khách hàng.

## Ảnh được lưu thế nào (để biết khi cần)

- Mỗi ảnh được đặt tên bằng **mã băm nội dung ảnh** (ví dụ `3f2a…c9.jpg`), nên cùng một ảnh tải hai lần chỉ lưu một bản, và tên file gốc trên máy bạn không bao giờ đi lên mạng.
- Máy chủ kiểm tra nội dung từng file (chỉ nhận JPG, PNG, GIF, WebP, tối đa 10 MB mỗi ảnh) trước khi lưu.
- Khi bạn xóa một ảnh khỏi album, ảnh đó cũng bị xóa khỏi bucket, trừ khi album khác vẫn đang dùng nó.
- Khi bạn bấm **Delete** một album ở trang **Admin → Albums**, mọi ảnh của album đó trên Cloudflare cũng bị xóa (trừ ảnh album khác còn dùng). Nếu Cloudflare không xóa được, album vẫn bị xóa và trang sẽ liệt kê tên các file còn lại để bạn xóa tay trong Cloudflare → R2 → bucket → Objects.
- Ảnh album tạo từ link (From URLs) **không** lưu lên Cloudflare: chúng vẫn nằm ở trang gốc.
