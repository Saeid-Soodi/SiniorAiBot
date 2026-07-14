# SiniorAiBot v5.3.3

این نسخه روی پایداری Wizardهای ادمین و ارسال پرامپت تمرکز دارد.

## اصلاح‌های مهم v5.3.3

- رفع تداخل Callbackهای عمومی و اختصاصی پنل ادمین؛ به‌خصوص حذف ادمین.
- تأییدیه امن قبل از حذف ادمین.
- افزودن دکمه‌های شیشه‌ای Skip برای نکته استفاده، لینک پست اصلی و تصویر پرامپت.
- نرمال‌سازی لینک کانال برای جلوگیری از رد شدن Inline Keyboard توسط Telegram.
- ارسال مقاوم پرامپت: اگر Telegram به‌دلیل Keyboard نامعتبر پیام دکمه‌دار را رد کند، متن پرامپت از دست نمی‌رود و خطای دقیق در لاگ ثبت می‌شود.
- لاگ دقیق‌تر خطاهای Telegram در مسیر ارسال پرامپت.
- اسکریپت `npm run check` برای بررسی Syntax همه فایل‌های JavaScript.


ربات تلگرام مدیریت، انتشار و تحویل پرامپت‌های هوش مصنوعی با VIP، رفرال، کیف پول، هدیه اشتراک، آموزش روزانه، گالری نتایج، پشتیبانی و پنل مدیریت سطح‌بندی‌شده.

## امکانات اصلی v5.3

- VIP سی‌روزه با قیمت پیش‌فرض 60,000 تومان و سهمیه روزانه 10 پرامپت
- تمدید VIP بدون سوختن زمان باقی‌مانده
- خرید اشتراک هدیه با لینک یک‌بارمصرف
- کمپین رفرال پیش‌فرض: 2 دعوت معتبر = 50٪ تخفیف
- کیف پول با مدل جداگانه `WalletTransaction` و تأیید کاربر قبل از برداشت
- شارژ کیف پول با رسید و تأیید مدیریت
- تاریخچه خرید و نتایج تأییدشده در حساب کاربر
- حذف مستقیم از علاقه‌مندی‌ها
- درخواست پرامپت با متن و تصویر اختیاری
- پشتیبانی داخل ربات و پاسخ مستقیم مالک
- پنل Owner ساده با یک دکمه آبی
- مدیریت ادمین‌ها و سطح دسترسی مجزا
- Wizard افزودن پرامپت با راهنما، پیش‌نمایش و تأیید نهایی
- مدیریت درخواست‌های پرامپت
- کد تخفیف با عنوان، آمار استفاده، تاریخ ساخت و پیش‌نمایش قبل از ثبت
- صفحه‌بندی برای لیست‌های مدیریتی
- انتشار مستقیم متن/عکس/ویدیو در کانال با پیش‌نمایش و تأیید
- مدیریت و ویرایش/حذف آموزش‌ها
- پیام همگانی با پیش‌نمایش و تأیید
- Unified State Manager برای جلوگیری از تداخل رسید، نتیجه، پشتیبانی و Wizardها
- سازگار با cPanel / CloudLinux / Passenger و IPv4-first برای Telegram API

## نصب محلی

```bash
npm install
cp .env.example .env
npm run dev
```

## استقرار cPanel

- Node.js 20 یا 22
- Application root: مسیر پروژه
- Startup file: `src/index.js`
- `PORT` را دستی روی 80/443/3001 تنظیم نکنید؛ Passenger پورت داخلی را تعیین می‌کند.
- متغیرهای `.env.example` را در Environment Variables وارد کنید.
- در CloudLinux، `node_modules` باید توسط Node.js Selector به محیط مجازی لینک شود.
- برای هاست‌هایی که IPv6 خروجی ندارند، `NODE_OPTIONS=--dns-result-order=ipv4first` را نگه دارید.

## امنیت

`.env`، توکن ربات، رمز MongoDB و اطلاعات هاست را در GitHub یا اسکرین‌شات عمومی قرار ندهید.

## v5.3.2

- Safe discount-code deletion with preserved usage history and restore support.
- Professional channel post builder with multiple inline URL buttons.
- Add buttons using manual URLs or select an existing prompt to generate its deep link automatically.
- Arrange buttons in new rows or beside the previous button (up to two per row, eight total).
- Manage/remove buttons before publishing.
- Full preview with working inline buttons before channel publication.
- Published channel posts are stored with Telegram message ID, post URL, media data, and button layout.
- Health endpoint version is read automatically from package.json.


## v5.3.2 fixes
- Fixed admin prompt wizard state progression after entering the title.
- Fixed channel post builder text/media/button wizard state progression.
- Added safer prompt validation and duplicate-slug handling.
- Hardened the in-memory state manager with expiration and update timestamps.


## v5.3.2 fixes
- Fixed admin prompt wizard state progression after entering the title.
- Fixed channel post builder text/media/button state progression.
- Added safer prompt validation and duplicate-slug handling.
- Hardened the in-memory state manager with one-hour state expiration.
