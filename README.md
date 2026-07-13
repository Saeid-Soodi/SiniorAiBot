# SiniorAiBot v5.2

ربات تلگرام مدیریت و تحویل پرامپت‌های هوش مصنوعی با امکانات VIP، رفرال، تخفیف، آمار کلیک، آموزش روزانه، علاقه‌مندی، امتیازدهی، گالری نتایج و پنل مدیریت.

## تغییر اصلی نسخه 5.2

- سازگاری بهتر با cPanel / CloudLinux Node.js Selector / Passenger
- استفاده از پورت داخلی تعیین‌شده توسط `process.env.PORT`
- دسترسی عمومی از طریق پورت‌های 80 و 443 توسط LiteSpeed/Passenger
- اجبار Node.js به ترجیح IPv4 برای جلوگیری از خطای `ETIMEDOUT` در ارتباط با Telegram API
- مسیرهای Health Check:
  - `/`
  - `/bot`
  - `/health`
- خاموش‌شدن امن هنگام Restart هاست

> روی هاست اشتراکی برنامه نباید مستقیماً روی پورت 80 یا 443 اجرا شود. وب‌سرور هاست این پورت‌ها را مدیریت می‌کند و درخواست‌ها را به پورت داخلی اپ می‌فرستد.

## نصب محلی

```bash
npm install
cp .env.example .env
npm run dev
```

## استقرار در cPanel

1. پروژه را با Git Version Control کلون کنید.
2. در Setup Node.js App:
   - Node.js: نسخه 20 یا 22
   - Application root: `SiniorAiBot`
   - Startup file: `src/index.js`
   - Mode: `Production`
3. متغیرهای `.env.example` را در Environment Variables وارد کنید.
4. متغیر `PORT` را دستی روی 80، 443 یا 3001 تنظیم نکنید؛ Passenger آن را تعیین می‌کند.
5. `Run NPM Install` و سپس `Restart` را بزنید.

## نکته شبکه تلگرام

کد به‌صورت داخلی از:

```js
dns.setDefaultResultOrder('ipv4first');
```

استفاده می‌کند؛ بنابراین در هاست‌هایی که IPv6 خروجی ندارند، درخواست‌های Telegram API از IPv4 و HTTPS پورت 443 ارسال می‌شوند.

## امنیت

فایل `.env` را در GitHub قرار ندهید. توکن ربات، رمز MongoDB، رمز هاست و شماره کارت را در چت، اسکرین‌شات یا مخزن عمومی منتشر نکنید.
