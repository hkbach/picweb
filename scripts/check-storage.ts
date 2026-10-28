import { createHash, randomBytes } from 'node:crypto';
import { getStorage, readR2Config, StorageError, storageDriver, type R2ErrorKind } from '../src/server/storage.ts';

// Tests the photo storage in four small steps and says in plain words what to fix:
//   npm run check-storage
// It uploads one tiny picture, opens it the way a visitor's browser would, and deletes it again.
// It never prints a key or a secret.
const ok = (text: string) => console.log(`   ✅ ${text}`);
const bad = (text: string) => console.log(`   ❌ ${text}`);
const hint = (text: string) => console.log(`      👉 ${text}`);
const step = (n: number, text: string) => console.log(`\n${n}/4  ${text}`);
const stop = (): never => {
	console.log('\n⛔ Chưa dùng được. Sửa theo gợi ý ở trên (file .env), rồi chạy lại lệnh này.\n');
	process.exit(1);
};

const WHERE: Record<string, string> = {
	R2_ACCOUNT_ID: 'Account ID: trang "R2 Object Storage" của Cloudflare, ở khung bên phải (32 ký tự).',
	R2_ACCESS_KEY_ID: 'Access Key ID: hiện ra một lần khi tạo API token (bước 4 trong hướng dẫn).',
	R2_SECRET_ACCESS_KEY: 'Secret Access Key: hiện ra MỘT LẦN khi tạo API token, hãy copy ngay (bước 4).',
	R2_BUCKET: 'Tên bucket bạn đã đặt ở bước 1 (ví dụ picweb-photos).',
	R2_PUBLIC_URL: 'Địa chỉ công khai của bucket (bước 3), dạng https://pub-xxxx.r2.dev',
};
const WHY: Record<string, string> = {
	'account-id': 'R2_ACCOUNT_ID phải đúng 32 ký tự (chữ a–f và số). Copy lại từ trang R2 của Cloudflare.',
	bucket: 'R2_BUCKET là tên bucket: 3–63 ký tự, chỉ chữ thường, số và dấu gạch ngang (-).',
	'public-url': 'R2_PUBLIC_URL phải là địa chỉ web đầy đủ, ví dụ https://pub-abc123.r2.dev (không thêm tên file phía sau).',
	endpoint: 'R2_ENDPOINT không hợp lệ. Thường KHÔNG cần đặt biến này: hãy xóa dòng đó.',
};
const WHAT_TO_DO: Record<R2ErrorKind, string> = {
	denied: 'Cloudflare từ chối. Kiểm tra R2_ACCESS_KEY_ID và R2_SECRET_ACCESS_KEY (copy đủ, không thừa dấu cách), và token phải có quyền "Object Read & Write" cho ĐÚNG bucket này.',
	bucket: 'Cloudflare không thấy bucket này. Kiểm tra R2_BUCKET (đúng chính tả) và bucket nằm trong cùng tài khoản với R2_ACCOUNT_ID.',
	unreachable: 'Không nối được tới Cloudflare. Kiểm tra R2_ACCOUNT_ID (số sai thì không tìm thấy địa chỉ) và kết nối Internet.',
	other: 'Có lỗi lạ khi nói chuyện với Cloudflare. Thử lại sau ít phút; nếu vẫn lỗi, kiểm tra lại cả 5 giá trị R2_ trong file .env.',
};

console.log('\nKIỂM TRA KẾT NỐI CLOUDFLARE R2');

step(1, 'Đọc cài đặt trong file .env');
if (storageDriver() !== 'r2') {
	bad(`STORAGE_DRIVER đang là "${storageDriver() || '(trống)'}", cần là r2.`);
	hint('Mở file .env và thêm dòng:  STORAGE_DRIVER=r2');
	stop();
}
const { config, missing, problems } = readR2Config();
for (const name of missing) {
	bad(`Thiếu ${name}`);
	hint(WHERE[name]);
}
for (const p of problems) {
	bad(`${p.variable} chưa đúng`);
	hint(WHY[p.why]);
}
if (!config) stop();
ok('Đủ 5 giá trị và đúng dạng.');
const resolved = config!;

step(2, 'Thử tải một ảnh nhỏ lên Cloudflare');
const storage = getStorage()!;
// A 1x1 picture with a few random bytes after it, so each run uses a new name and is never mistaken for an old copy.
const picture = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), randomBytes(8)]);
const key = `${createHash('sha256').update(picture).digest('hex').slice(0, 32)}.png`;
let publicAddress = '';
try {
	publicAddress = await storage.put(key, picture, 'image/png');
	ok('Tải lên thành công.');
} catch (error) {
	bad('Không tải lên được.');
	hint(WHAT_TO_DO[error instanceof StorageError ? error.kind : 'other']);
	stop();
}

step(3, 'Mở ảnh đó bằng địa chỉ công khai, như trình duyệt của khách');
let reachable = false;
let status = 0;
for (let attempt = 0; attempt < 4 && !reachable; attempt++) {
	if (attempt > 0) await new Promise((r) => setTimeout(r, 1500)); // a new file can take a moment to appear
	try {
		const response = await fetch(publicAddress, { signal: AbortSignal.timeout(10_000) });
		status = response.status;
		const body = Buffer.from(await response.arrayBuffer());
		reachable = response.ok && (response.headers.get('content-type') ?? '').startsWith('image/') && body.equals(picture);
	} catch {
		status = 0;
	}
}
if (reachable) {
	ok('Ảnh mở được từ địa chỉ công khai.');
} else {
	bad(status === 0 ? 'Không mở được địa chỉ công khai.' : `Địa chỉ công khai trả về mã ${status} (không phải ảnh).`);
	if (status === 401 || status === 403 || status === 404) {
		hint('Bucket chưa cho phép xem công khai. Trong Cloudflare: R2 → bucket của bạn → Settings → Public Development URL → Enable → gõ chữ allow → Allow Access (bước 3).');
	}
	hint('Kiểm tra R2_PUBLIC_URL có đúng là địa chỉ công khai của CHÍNH bucket này (copy lại từ Settings).');
}

step(4, 'Xóa ảnh thử');
try {
	await storage.remove(key);
	ok('Đã xóa ảnh thử khỏi Cloudflare.');
} catch {
	console.log('   ⚠️ Không xóa được ảnh thử (không sao, nó rất nhỏ). Token có thể thiếu quyền xóa: hãy chọn "Object Read & Write".');
}

if (!reachable) stop();
console.log('\n🎉 Mọi thứ hoạt động. Bây giờ bạn có thể tạo album với ảnh tải lên, ảnh sẽ lưu trên Cloudflare.');
if (/(^|\.)r2\.dev$/i.test(new URL(resolved.publicUrl).hostname)) {
	console.log('\n⚠️  Lưu ý: địa chỉ r2.dev chỉ dành để thử nghiệm (Cloudflare giới hạn tốc độ). Khi chạy thật, hãy gắn tên miền riêng cho bucket');
	console.log('   (Settings → Custom Domains) rồi đổi R2_PUBLIC_URL sang tên miền đó.');
}
console.log('');
