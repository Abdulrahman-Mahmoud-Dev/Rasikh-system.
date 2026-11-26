# تجهيز الربط النهائي — نظام راسخ

هذا الدليل خاص بمستودع **Rasikh-system.** الحالي. الهدف أن تُجمع الإعدادات المطلوبة، ثم تُدخل مرة واحدة عند اختيار استضافة الـBackend وقاعدة البيانات.

## 1. ما الذي يمنع الدخول الآن؟

الرسالة الحمراء في صفحة الدخول تعني أن:

- `API_BASE_URL` في `assets/js/rasikh-config.js` فارغ.
- لذلك لا تستطيع الواجهة إرسال تسجيل الدخول إلى الخادم.
- لا توجد الآن خدمة Backend منشورة مرتبطة بالموقع؛ GitHub Pages ينشر ملفات الواجهة فقط، ولا يشغّل Fastify أو PostgreSQL.

لا تكرر محاولة تسجيل الدخول أو إنشاء حساب قبل تشغيل الـBackend وربطه. وجود البريد وكلمة المرور في الخانات لا يعني أن الحساب أصبح مسجلًا على الخادم.

## 2. عنوان موقع راسخ الفعلي

استخدم القيم التالية كما هي عند إعداد الخدمات الخارجية:

| الإعداد | القيمة |
|---|---|
| GitHub Pages Origin / CORS_ORIGIN | `https://abdulrahman-mahmoud-dev.github.io` |
| رابط الواجهة الكامل / PUBLIC_APP_URL | `https://abdulrahman-mahmoud-dev.github.io/Rasikh-system.` |
| مسار المشروع في GitHub Pages | `/Rasikh-system./` |

**مهم:** قيمة `CORS_ORIGIN` هي النطاق فقط، بلا مسار المستودع أو شرطة أخيرة. أما `PUBLIC_APP_URL` فيتضمن مسار المستودع.

## 3. تجهيز الـBackend وقاعدة البيانات

أُضيف إلى المستودع:

- `backend/Dockerfile`: يبني Backend على Node.js 22 ويجهزه للتشغيل.
- `backend/.dockerignore`: يمنع إدخال ملفات البيئة والأسرار إلى صورة Docker.
- `compose.yaml`: يشغل PostgreSQL والـBackend محليًا، مع خدمة منفصلة لتطبيق الترحيلات.
- `.env.example` و`.gitignore`: نموذج آمن للإعداد المحلي مع استبعاد ملف `.env` من Git.
- فحص بناء Docker ضمن GitHub Actions.

عند اختيار مزود الاستضافة، اجعل إعداد خدمة Backend كالآتي:

| الإعداد لدى مزود الاستضافة | القيمة |
|---|---|
| طريقة البناء | Docker |
| مجلد البناء / Root Directory | `backend` |
| ملف Docker | `Dockerfile` |
| منفذ الخدمة | استخدم متغير `PORT` الذي يحدده المزود |
| فحص الصحة | `/health` |
| فحص جاهزية قاعدة البيانات | `/health/ready` |
| قاعدة البيانات | PostgreSQL |

يجب أن يدعم المزود تشغيل حاوية Docker، ومتغيرات البيئة السرية، والاتصال بقاعدة PostgreSQL. فضّل منطقة داخل السعودية عند توفرها؛ ولا نختار مزودًا أو ندفع اشتراكًا قبل مقارنة المنطقة والتكلفة والنسخ الاحتياطي.

### متغيرات بيئة الـBackend

أضف هذه القيم في صفحة Environment Variables أو Secrets لدى مزود الاستضافة، ولا تضعها في GitHub:

| المتغير | القيمة المطلوبة |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | يحدده مزود الاستضافة عادةً؛ لا تثبّت رقمًا إذا كان المزود يمرره تلقائيًا |
| `DATABASE_URL` | رابط PostgreSQL الذي يعطيك المزود |
| `COOKIE_SECRET` | سر عشوائي قوي، ٣٢ حرفًا على الأقل |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAME_SITE` | `none` عند استخدام موقع الواجهة الحالي مع Backend على نطاق خارجي مختلف |
| `CORS_ORIGIN` | `https://abdulrahman-mahmoud-dev.github.io` |
| `PUBLIC_APP_URL` | `https://abdulrahman-mahmoud-dev.github.io/Rasikh-system.` |
| `LOG_LEVEL` | `info` |

لا تستخدم عنوان GitHub Pages مكان `DATABASE_URL` أو `API_BASE_URL`. الأول رابط قاعدة البيانات، والثاني رابط الـBackend المنشور.

### تطبيق ترحيلات قاعدة البيانات

بعد إنشاء قاعدة PostgreSQL وربطها بالـBackend، شغّل أمر الترحيلات مرة واحدة قبل اختبار الدخول:

```bash
npm run db:migrate:built
```

إذا كانت الاستضافة تستخدم Docker، شغّل الأمر داخل بيئة الحاوية أو كـ Release/Job command بعد البناء وقبل تشغيل الاستخدام الفعلي. لا تشغّل ترحيلات على قاعدة بيانات إنتاج تحتوي بيانات قبل أخذ نسخة احتياطية والتحقق من البيئة.

## 4. ربط واجهة GitHub Pages بالـBackend

بعد أن يعطيك مزود الاستضافة عنوانًا عامًا آمنًا يبدأ بـ `https://`، افتح:

`assets/js/rasikh-config.js`

وضع:

- `API_BASE_URL`: أصل عنوان Backend فقط، مثال شكلي: `https://api.example.com`، بلا `/api/v1` في النهاية.
- `GOOGLE_CLIENT_ID`: معرّف Web Client الذي ستنشئه في Google Cloud.

لا تضع في هذا الملف كلمة مرور، أو `DATABASE_URL`، أو `COOKIE_SECRET`، أو `EMAILJS_PRIVATE_KEY`، أو Google Client Secret.

بعد حفظ التعديل ودمجه في `main`، يعيد GitHub Pages نشر الواجهة. لا تضع عنوانًا تخمينيًا؛ انتظر حتى تحصل على عنوان Backend حقيقي.

## 5. إعداد تسجيل Google

زر Google الموجود في الكود هو الزر الرسمي الذي تعرضه مكتبة Google Identity Services. لن يظهر الزر القابل للاستخدام إلا بعد تحقق الشروط الثلاثة معًا:

1. نشر Backend وإتاحة المسار `POST /api/v1/auth/google/nonce`.
2. وضع Web OAuth Client ID الصحيح في `assets/js/rasikh-config.js`.
3. وضع معرّف العميل نفسه في متغير Backend باسم `GOOGLE_CLIENT_ID`.

خطوات Google Cloud:

1. افتح Google Cloud Console واختر مشروع راسخ.
2. أكمل إعداد OAuth consent screen.
3. أنشئ OAuth Client ID من نوع **Web application**.
4. في **Authorized JavaScript origins** أضف هذا الأصل حرفيًا:
   `https://abdulrahman-mahmoud-dev.github.io`
5. لا تضف مسار `/Rasikh-system./` إلى خانة Origin.
6. انسخ **Web Client ID** وضع القيمة نفسها في الواجهة والـBackend.

لا تنشئ أو تضع Client Secret في الواجهة. لا يوجد في المستودع Client ID حقيقي حتى الآن، ولا يمكن توليده من GitHub.

**لماذا لا يظهر الزر الآن؟** لأن الإعدادين فارغان، والواجهة تحتاج أيضًا الحصول على Nonce من الـBackend قبل رسم زر Google؛ وهذا مقصود لحماية تدفق تسجيل الدخول، وليس خللًا في تصميم الصفحة.

## 6. إعداد البريد عبر EmailJS

الخدمة والمفتاح العام موجودان مسبقًا في إعدادات Backend:

- Service ID: `service_5lcvg4g`
- Public Key: `R-1PwjvGMVEsTg1j5`

المتبقي خارج GitHub: إنشاء قالبين جديدين في حساب EmailJS ثم نسخ Template IDs إلى أسرار الـBackend:

- `EMAILJS_INVITATION_TEMPLATE_ID`
- `EMAILJS_ACCOUNT_TEMPLATE_ID`

القالب الأول لإشعار إضافة عضو، والثاني لتأكيد البريد واستعادة كلمة المرور. لا تستخدم القالب القديم `template_mzni57z`؛ فهو قالب OTP قديم وليس مخصصًا لهذين الغرضين.

راجع `docs/setup/google-emailjs-authentication.md` لأسماء الحقول والنصوص المطلوبة داخل القالبين. لا تحفظ `EMAILJS_PRIVATE_KEY` إلا في أسرار Backend، إذا قررت تفعيله.

## 7. ملاحظة مهمة حول جلسات الدخول

الموقع الحالي يعمل على نطاق `github.io`، بينما قد يستضيف مزود الـBackend الخدمة على نطاق مختلف. في هذه الحالة يحتاج التطبيق إلى كوكيز آمنة عابرة للمواقع (`SameSite=None` و`Secure=true`)، لكن بعض المتصفحات قد تمنع كوكيز الطرف الثالث.

لذلك لا نعتبر اتصال الواجهة بخادم على نطاق مختلف مكتملًا بمجرد نجاح فحص الصحة. يجب اختبار تسجيل الدخول واستمرار الجلسة على متصفح الهاتف والكمبيوتر. والحل الأفضل على المدى الطويل هو ربط الواجهة والـAPI بنطاق مملوك واحد، مثل واجهة على النطاق الأساسي وAPI على نطاق فرعي منه، أو استخدام Proxy من النطاق نفسه.

## 8. تشغيل نسخة محلية للتجربة

يمكن لصاحب الخبرة التقنية تشغيل PostgreSQL والـBackend محليًا عبر Docker Compose:

1. انسخ `.env.example` إلى ملف باسم `.env` في جذر المستودع.
2. غيّر `POSTGRES_PASSWORD` و`COOKIE_SECRET` إلى قيم عشوائية قوية.
3. نفّذ:

```bash
docker compose build
docker compose --profile tools run --rm backend-migrate
docker compose up -d postgres backend
```

4. شغّل الواجهة من جذر المستودع على المنفذ 5500، مثلًا عبر Live Server أو:

```bash
python -m http.server 5500
```

5. للاختبار المحلي فقط، اجعل `API_BASE_URL` في `assets/js/rasikh-config.js` مساويًا لـ `http://localhost:3000`. أعده إلى عنوان Backend العام عند الانتقال إلى الموقع المنشور.

إذا لم يكن Docker مثبتًا على الجهاز، لا يلزمك تنفيذ الخطوات المحلية بنفسك؛ يمكن لصاحب الخبرة تشغيلها، أو ننفذ إعداد الاستضافة الخارجية خطوة بخطوة لاحقًا.

## 9. اختبار الربط قبل اعتماد الدخول

بعد ربط جميع الخدمات:

- افتح `https://BACKEND-HOST/health` وتأكد من أن الخادم يرد بحالة سليمة.
- افتح `https://BACKEND-HOST/health/ready` وتأكد من أن PostgreSQL متصل.
- تأكد أن زر Google الرسمي ظهر، ثم اختبر الدخول بحساب Google تجريبي.
- أنشئ حساب بريد تجريبيًا وتأكد من وصول رسالة تأكيد البريد.
- اختبر تسجيل الدخول والخروج واستمرار الجلسة بعد تحديث الصفحة.
- اختبر استعادة كلمة المرور، ثم دعوة عضو جديد ودعوة حساب موجود.
- اختبر صلاحيات المعلم ومساعد الحلقة وولي الأمر قبل إدخال بيانات حقيقية.

نجاح GitHub Actions أو نشر GitHub Pages لا يعني أن Backend أو قاعدة البيانات أو Google أو EmailJS أصبحت متصلة. لا تبدأ باستخدام بيانات حقيقية إلا بعد اجتياز الاختبارات أعلاه.
