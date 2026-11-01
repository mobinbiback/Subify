/*! Subify account UI (popup + options), bilingual (فارسی / English).
 *  - popup: sign-in wall when login is required; a "My account" bar when signed in.
 *  - options: sign-in card; when signed in the page opens the MEMBER PANEL (profile, support tickets);
 *    the technical settings move into a collapsed "Advanced settings" section.
 *  All network access goes through background.js (the page never reads the session cookie). */
(function () {
  'use strict';
  var api = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!api || !api.runtime || !api.runtime.sendMessage) return;
  var SITE = 'https://sub-ify.site';
  var IS_OPTIONS = !!document.querySelector('main.wrap');
  var wallEl = null, timer = null, panel = null, bar = null, lastUser = null, view = { name: 'home' }, busy = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** both languages, always: the UI-language line first, English under it */
  // One language per screen: English UI shows the English text only, Persian UI shows the Persian text only.
  var GATE_T = {
    "ادامه با Google": {"ar": "المتابعة عبر Google", "es": "Continuar con Google", "tr": "Google ile devam et", "fr": "Continuer avec Google", "de": "Mit Google fortfahren"},
    "ادامه با GitHub": {"ar": "المتابعة عبر GitHub", "es": "Continuar con GitHub", "tr": "GitHub ile devam et", "fr": "Continuer avec GitHub", "de": "Mit GitHub fortfahren"},
    "ادامه با LinkedIn": {"ar": "المتابعة عبر LinkedIn", "es": "Continuar con LinkedIn", "tr": "LinkedIn ile devam et", "fr": "Continuer avec LinkedIn", "de": "Mit LinkedIn fortfahren"},
    "منتظر ورود تو هستیم…": {"ar": "بانتظار تسجيل دخولك…", "es": "Esperando a que inicies sesión…", "tr": "Girişini bekliyoruz…", "fr": "En attente de votre connexion…", "de": "Warten auf deine Anmeldung…"},
    "در حال بررسی…": {"ar": "جارٍ التحقق…", "es": "Comprobando…", "tr": "Kontrol ediliyor…", "fr": "Vérification…", "de": "Wird geprüft…"},
    "جارٍ التحقق…": {"ar": "جارٍ التحقق…", "es": "Comprobando…", "tr": "Kontrol ediliyor…", "fr": "Vérification…", "de": "Wird geprüft…"},
    "اتصال به سرور ورود برقرار نشد": {"ar": "تعذّر الوصول إلى خادم تسجيل الدخول", "es": "No se pudo conectar con el servidor de inicio de sesión", "tr": "Giriş sunucusuna bağlanılamadı", "fr": "Impossible de joindre le serveur de connexion", "de": "Verbindung zum Anmeldeserver fehlgeschlagen"},
    "تعذّر الوصول إلى خادم تسجيل الدخول": {"ar": "تعذّر الوصول إلى خادم تسجيل الدخول", "es": "No se pudo conectar con el servidor de inicio de sesión", "tr": "Giriş sunucusuna bağlanılamadı", "fr": "Impossible de joindre le serveur de connexion", "de": "Verbindung zum Anmeldeserver fehlgeschlagen"},
    "اینترنت یا فیلترشکن را بررسی کن.": {"ar": "تحقّق من الإنترنت أو VPN.", "es": "Revisa tu internet o VPN.", "tr": "İnternet bağlantını veya VPN'i kontrol et.", "fr": "Vérifiez votre connexion Internet ou votre VPN.", "de": "Prüfe dein Internet oder VPN."},
    "تحقّق من الإنترنت أو VPN.": {"ar": "تحقّق من الإنترنت أو VPN.", "es": "Revisa tu internet o VPN.", "tr": "İnternet bağlantını veya VPN'i kontrol et.", "fr": "Vérifiez votre connexion Internet ou votre VPN.", "de": "Prüfe dein Internet oder VPN."},
    "ورود لغو شد": {"ar": "أُلغي تسجيل الدخول", "es": "Inicio de sesión cancelado", "tr": "Giriş iptal edildi", "fr": "Connexion annulée", "de": "Anmeldung abgebrochen"},
    "نشست ورود منقضی شد؛ دوباره تلاش کن.": {"ar": "انتهت جلسة تسجيل الدخول. حاول مرة أخرى.", "es": "La sesión de inicio expiró. Vuelve a intentarlo.", "tr": "Giriş oturumu sona erdi. Tekrar dene.", "fr": "La session de connexion a expiré. Réessayez.", "de": "Die Anmeldesitzung ist abgelaufen. Versuche es erneut."},
    "ورود با این روش هنوز تنظیم نشده است.": {"ar": "لم يُعدّ تسجيل الدخول بهذه الطريقة بعد.", "es": "Este método de inicio aún no está configurado.", "tr": "Bu giriş yöntemi henüz ayarlanmadı.", "fr": "Cette méthode de connexion n'est pas encore configurée.", "de": "Diese Anmeldemethode ist noch nicht eingerichtet."},
    "ورود و ثبت‌نام فعلاً بسته است.": {"ar": "تسجيل الدخول وإنشاء الحساب مغلقان حاليًا.", "es": "El inicio de sesión y el registro están cerrados por ahora.", "tr": "Giriş ve kayıt şimdilik kapalı.", "fr": "La connexion et l'inscription sont fermées pour le moment.", "de": "Anmeldung und Registrierung sind vorerst geschlossen."},
    "این حساب مسدود شده است.": {"ar": "تم حظر هذا الحساب.", "es": "Esta cuenta está bloqueada.", "tr": "Bu hesap engellendi.", "fr": "Ce compte a été bloqué.", "de": "Dieses Konto wurde gesperrt."},
    "ایمیل تأییدشده‌ای پیدا نشد؛ ایمیلت را در Google/GitHub تأیید کن.": {"ar": "لم يُعثر على بريد مُتحقَّق منه. أكّد بريدك في Google/GitHub.", "es": "No se encontró un correo verificado. Verifica tu correo en Google/GitHub.", "tr": "Doğrulanmış e-posta bulunamadı. E-postanı Google/GitHub'da doğrula.", "fr": "Aucun e-mail vérifié trouvé. Vérifiez votre e-mail dans Google/GitHub.", "de": "Keine verifizierte E-Mail gefunden. Bestätige deine E-Mail bei Google/GitHub."},
    "ارتباط با سرویس ورود برقرار نشد؛ کمی بعد دوباره تلاش کن.": {"ar": "تعذّر الاتصال بخدمة تسجيل الدخول. حاول بعد قليل.", "es": "No se pudo conectar con el servicio de inicio. Inténtalo de nuevo en un momento.", "tr": "Giriş servisine bağlanılamadı. Biraz sonra tekrar dene.", "fr": "Impossible de joindre le service de connexion. Réessayez dans un instant.", "de": "Verbindung zum Anmeldedienst fehlgeschlagen. Versuche es gleich noch einmal."},
    "تلاش‌های زیاد؛ یک دقیقه صبر کن.": {"ar": "محاولات كثيرة. انتظر دقيقة.", "es": "Demasiados intentos. Espera un minuto.", "tr": "Çok fazla deneme. Bir dakika bekle.", "fr": "Trop de tentatives. Attendez une minute.", "de": "Zu viele Versuche. Warte eine Minute."},
    "مشکلی پیش آمد؛ دوباره تلاش کن.": {"ar": "حدث خطأ. حاول مرة أخرى.", "es": "Algo salió mal. Inténtalo de nuevo.", "tr": "Bir sorun oluştu. Tekrar dene.", "fr": "Un problème est survenu. Réessayez.", "de": "Etwas ist schiefgelaufen. Versuche es erneut."},
    "این نام کاربری گرفته شده است.": {"ar": "اسم المستخدم هذا مأخوذ.", "es": "Este nombre de usuario ya está en uso.", "tr": "Bu kullanıcı adı alınmış.", "fr": "Ce nom d'utilisateur est déjà pris.", "de": "Dieser Benutzername ist bereits vergeben."},
    "این ایمیل قبلاً ثبت شده است.": {"ar": "هذا البريد مسجَّل من قبل.", "es": "Este correo ya está registrado.", "tr": "Bu e-posta zaten kayıtlı.", "fr": "Cet e-mail est déjà enregistré.", "de": "Diese E-Mail ist bereits registriert."},
    "نام کاربری درست نیست. راهنمای زیر فیلد را ببین.": {"ar": "اسم المستخدم غير صالح. راجع الملاحظة أسفل الحقل.", "es": "El nombre de usuario no es válido. Mira la nota debajo del campo.", "tr": "Kullanıcı adı geçerli değil. Alanın altındaki nota bak.", "fr": "Nom d'utilisateur invalide. Voir la note sous le champ.", "de": "Benutzername ungültig. Siehe den Hinweis unter dem Feld."},
    "رمز عبور باید ۸ تا ۱۲۸ نویسه باشد.": {"ar": "يجب أن تكون كلمة المرور بين 8 و128 حرفًا.", "es": "La contraseña debe tener entre 8 y 128 caracteres.", "tr": "Şifre 8 ile 128 karakter arasında olmalı.", "fr": "Le mot de passe doit comporter entre 8 et 128 caractères.", "de": "Das Passwort muss 8 bis 128 Zeichen lang sein."},
    "ایمیل درست نیست.": {"ar": "البريد الإلكتروني غير صالح.", "es": "El correo no es válido.", "tr": "E-posta geçerli değil.", "fr": "L'e-mail n'est pas valide.", "de": "E-Mail ist ungültig."},
    "نام کاربری، ایمیل یا رمز عبور اشتباه است.": {"ar": "اسم المستخدم أو البريد أو كلمة المرور غير صحيحة.", "es": "Usuario, correo o contraseña incorrectos.", "tr": "Kullanıcı adı, e-posta veya şifre yanlış.", "fr": "Nom d'utilisateur, e-mail ou mot de passe incorrect.", "de": "Benutzername, E-Mail oder Passwort ist falsch."},
    "تلاش‌های زیاد؛ چند دقیقه صبر کن.": {"ar": "محاولات كثيرة. انتظر بضع دقائق.", "es": "Demasiados intentos. Espera unos minutos.", "tr": "Çok fazla deneme. Birkaç dakika bekle.", "fr": "Trop de tentatives. Attendez quelques minutes.", "de": "Zu viele Versuche. Warte ein paar Minuten."},
    "درخواست از این مسیر پذیرفته نشد.": {"ar": "لم يُقبل الطلب من هذا المسار.", "es": "Esta solicitud no fue aceptada.", "tr": "Bu istek kabul edilmedi.", "fr": "Cette demande n'a pas été acceptée.", "de": "Diese Anfrage wurde nicht akzeptiert."},
    "اطلاعات ناقص یا نادرست است؛ فیلدها را بررسی کن.": {"ar": "المعلومات ناقصة أو غير صحيحة. راجع الحقول.", "es": "Faltan datos o son incorrectos. Revisa los campos.", "tr": "Bilgiler eksik veya hatalı. Alanları kontrol et.", "fr": "Informations manquantes ou incorrectes. Vérifiez les champs.", "de": "Angaben fehlen oder sind falsch. Prüfe die Felder."},
    "درخواست خیلی بزرگ است.": {"ar": "الطلب كبير جدًا.", "es": "La solicitud es demasiado grande.", "tr": "İstek çok büyük.", "fr": "La demande est trop volumineuse.", "de": "Die Anfrage ist zu groß."},
    "درخواست نادرست بود؛ دوباره تلاش کن.": {"ar": "الطلب غير صحيح. حاول مرة أخرى.", "es": "Solicitud incorrecta. Inténtalo de nuevo.", "tr": "Hatalı istek. Tekrar dene.", "fr": "Requête incorrecte. Réessayez.", "de": "Ungültige Anfrage. Versuche es erneut."},
    "اتصال به سرور برقرار نشد.": {"ar": "تعذّر الاتصال بالخادم.", "es": "No se pudo conectar al servidor.", "tr": "Sunucuya bağlanılamadı.", "fr": "Impossible de se connecter au serveur.", "de": "Verbindung zum Server fehlgeschlagen."},
    "ورود": {"ar": "تسجيل الدخول", "es": "Iniciar sesión", "tr": "Giriş yap", "fr": "Connexion", "de": "Anmelden"},
    "ساخت حساب": {"ar": "إنشاء حساب", "es": "Crear cuenta", "tr": "Hesap oluştur", "fr": "Créer un compte", "de": "Konto erstellen"},
    "نام کاربری یا ایمیل": {"ar": "اسم المستخدم أو البريد", "es": "Usuario o correo", "tr": "Kullanıcı adı veya e-posta", "fr": "Nom d'utilisateur ou e-mail", "de": "Benutzername oder E-Mail"},
    "رمز عبور": {"ar": "كلمة المرور", "es": "Contraseña", "tr": "Şifre", "fr": "Mot de passe", "de": "Passwort"},
    "نام کاربری": {"ar": "اسم المستخدم", "es": "Usuario", "tr": "Kullanıcı adı", "fr": "Nom d'utilisateur", "de": "Benutzername"},
    "۳ تا ۲۴ نویسه: حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط. با حرف یا عدد شروع کن.": {"ar": "من 3 إلى 24 حرفًا: أحرف إنجليزية وأرقام ونقطة وشرطة أو شرطة سفلية. ابدأ بحرف أو رقم.", "es": "De 3 a 24 caracteres: letras, números, punto, guion o guion bajo. Empieza con una letra o número.", "tr": "3 ile 24 karakter: harf, rakam, nokta, tire veya alt çizgi. Bir harf veya rakamla başla.", "fr": "De 3 à 24 caractères : lettres, chiffres, point, tiret ou tiret bas. Commencez par une lettre ou un chiffre.", "de": "3 bis 24 Zeichen: Buchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich. Beginne mit einem Buchstaben oder einer Ziffer."},
    "۸ تا ۱۲۸ نویسه.": {"ar": "من 8 إلى 128 حرفًا.", "es": "De 8 a 128 caracteres.", "tr": "8 ile 128 karakter.", "fr": "De 8 à 128 caractères.", "de": "8 bis 128 Zeichen."},
    "ایمیل (اختیاری)": {"ar": "البريد الإلكتروني (اختياري)", "es": "Correo (opcional)", "tr": "E-posta (isteğe bağlı)", "fr": "E-mail (facultatif)", "de": "E-Mail (optional)"},
    "اختیاری است. بعداً برای بازیابی رمز عبورت از آن استفاده می‌کنیم.": {"ar": "اختياري. سنستخدمه لاحقًا لاستعادة كلمة المرور.", "es": "Opcional. Lo usaremos más adelante para recuperar tu contraseña.", "tr": "İsteğe bağlı. Şifreni kurtarmak için ileride kullanacağız.", "fr": "Facultatif. Nous l'utiliserons plus tard pour récupérer votre mot de passe.", "de": "Optional. Wir nutzen sie später, um dein Passwort wiederherzustellen."},
    "در حال ورود…": {"ar": "جارٍ تسجيل الدخول…", "es": "Iniciando sesión…", "tr": "Giriş yapılıyor…", "fr": "Connexion…", "de": "Anmelden…"},
    "در حال ساخت حساب…": {"ar": "جارٍ إنشاء الحساب…", "es": "Creando cuenta…", "tr": "Hesap oluşturuluyor…", "fr": "Création du compte…", "de": "Konto wird erstellt…"},
    "یا": {"ar": "أو", "es": "o", "tr": "veya", "fr": "ou", "de": "oder"},
    "تلاش دوباره": {"ar": "حاول مرة أخرى", "es": "Intentar de nuevo", "tr": "Tekrar dene", "fr": "Réessayer", "de": "Erneut versuchen"},
    "برای ادامه وارد شو": {"ar": "سجّل الدخول للمتابعة", "es": "Inicia sesión para continuar", "tr": "Devam etmek için giriş yap", "fr": "Connectez-vous pour continuer", "de": "Zum Fortfahren anmelden"},
    "با یکی از روش‌های زیر وارد شو. اگر حساب نداشته باشی، همان‌جا ساخته می‌شود.": {"ar": "سجّل الدخول بإحدى الطرق التالية. إن لم يكن لديك حساب فسيُنشأ هنا.", "es": "Inicia sesión con uno de los métodos siguientes. Si no tienes cuenta, se crea aquí mismo.", "tr": "Aşağıdaki yöntemlerden biriyle giriş yap. Hesabın yoksa burada oluşturulur.", "fr": "Connectez-vous avec l'une des méthodes ci-dessous. Si vous n'avez pas de compte, il sera créé ici.", "de": "Melde dich mit einer der folgenden Methoden an. Wenn du noch kein Konto hast, wird es hier erstellt."},
    "ده منبع رایگان بدون ورود استفاده شد.": {"ar": "تم استخدام عشرة مصادر مجانية بدون تسجيل دخول.", "es": "Se usaron diez fuentes gratuitas sin iniciar sesión.", "tr": "Giriş yapmadan on ücretsiz kaynak kullanıldı.", "fr": "Dix sources gratuites ont été utilisées sans connexion.", "de": "Zehn kostenlose Quellen wurden ohne Anmeldung genutzt."},
    "ورود با Google، GitHub یا LinkedIn در تب جدید باز می‌شود. بعد از پایان، این‌جا «وارد شدم» را بزن.": {"ar": "يُفتح تسجيل الدخول عبر Google أو GitHub أو LinkedIn في تبويب جديد. عند الانتهاء، اضغط «سجّلت الدخول» هنا.", "es": "El inicio con Google, GitHub o LinkedIn se abre en una pestaña nueva. Al terminar, pulsa «Ya inicié sesión» aquí.", "tr": "Google, GitHub veya LinkedIn ile giriş yeni sekmede açılır. Bitince buradan «Giriş yaptım»a bas.", "fr": "La connexion avec Google, GitHub ou LinkedIn s'ouvre dans un nouvel onglet. Une fois terminé, cliquez ici sur « Je me suis connecté ».", "de": "Die Anmeldung mit Google, GitHub oder LinkedIn öffnet sich in einem neuen Tab. Wenn du fertig bist, klicke hier auf „Ich bin angemeldet“."},
    "وارد شدم؛ بررسی کن": {"ar": "سجّلت الدخول؛ تحقّق", "es": "Ya inicié sesión; comprobar", "tr": "Giriş yaptım; kontrol et", "fr": "Je me suis connecté ; vérifier", "de": "Ich bin angemeldet; prüfen"},
    "حساب من / My account": {"ar": "حسابي", "es": "Mi cuenta", "tr": "Hesabım", "fr": "Mon compte", "de": "Mein Konto"},
    "ورود اختیاری: ": {"ar": "تسجيل الدخول اختياري:", "es": "Inicio opcional:", "tr": "İsteğe bağlı giriş:", "fr": "Connexion facultative :", "de": "Optionale Anmeldung:"},
    " از ": {"ar": "من", "es": "de", "tr": "/", "fr": "sur", "de": "von"},
    "چت و مربی": {"ar": "الدردشة والمدرّب", "es": "Chat y tutor", "tr": "Sohbet ve eğitmen", "fr": "Chat et tuteur", "de": "Chat und Tutor"},
    "نگارش": {"ar": "الإصدار", "es": "Versión", "tr": "Sürüm", "fr": "Version", "de": "Version"},
    "نقش‌آفرینی": {"ar": "لعب الأدوار", "es": "Juego de roles", "tr": "Rol yapma", "fr": "Jeu de rôle", "de": "Rollenspiel"},
    "تمرین تلفظ": {"ar": "تدريب النطق", "es": "Práctica de pronunciación", "tr": "Telaffuz alıştırması", "fr": "Entraînement à la prononciation", "de": "Aussprachetraining"},
    "ترجمه‌ی لغت و کارهای دیگر": {"ar": "ترجمة الكلمات والمزيد", "es": "Traducción de palabras y más", "tr": "Kelime çevirisi ve diğerleri", "fr": "Traduction de mots et plus", "de": "Wortübersetzung und mehr"},
    "هوش مصنوعی رایگان": {"ar": "الذكاء الاصطناعي المجاني", "es": "IA gratuita", "tr": "Ücretsiz yapay zeka", "fr": "IA gratuite", "de": "Kostenlose KI"},
    "فعال": {"ar": "مفعّل", "es": "Activo", "tr": "Aktif", "fr": "Actif", "de": "Aktiv"},
    "خاموش": {"ar": "متوقف", "es": "Desactivado", "tr": "Kapalı", "fr": "Désactivé", "de": "Aus"},
    "منابع این ماه": {"ar": "المصادر هذا الشهر", "es": "Recursos de este mes", "tr": "Bu ayki kaynaklar", "fr": "Ressources de ce mois", "de": "Quellen in diesem Monat"},
    "منبع یک فایل، ویدیو یا جلسه است. بازنشانی اول ماه بعد، ساعت ": {"ar": "المصدر هو ملف أو فيديو أو جلسة. تتم إعادة الضبط في أول الشهر القادم، الساعة", "es": "Un recurso es un archivo, video o sesión. Se reinicia el día 1 del mes siguiente, a las", "tr": "Bir kaynak bir dosya, video veya oturumdur. Ay başında sıfırlanır, saat", "fr": "Une ressource correspond à un fichier, une vidéo ou une session. Réinitialisation le 1er du mois suivant, à", "de": "Eine Quelle ist eine Datei, ein Video oder eine Sitzung. Zurückgesetzt am 1. des Folgemonats um"},
    "امروز": {"ar": "اليوم", "es": "Hoy", "tr": "Bugün", "fr": "Aujourd'hui", "de": "Heute"},
    "بازنشانی امروز ساعت ": {"ar": "تتم إعادة الضبط اليوم الساعة", "es": "Se reinicia hoy a las", "tr": "Bugün saat", "fr": "Réinitialisation aujourd'hui à", "de": "Zurücksetzung heute um"},
    " به وقت تو، ": {"ar": "بتوقيتك،", "es": "hora local,", "tr": "yerel saatinle,", "fr": "heure locale,", "de": "deine Zeit,"},
    " ساعت و ": {"ar": "ساعة و", "es": "horas y", "tr": "saat", "fr": "heures et", "de": "Stunden und"},
    " دقیقه دیگر": {"ar": "دقيقة متبقية", "es": "minutos restantes", "tr": "dakika kaldı", "fr": "minutes restantes", "de": "Minuten übrig"},
    "اگر کلید خودت را ذخیره کنی، درخواست‌ها با کلید تو می‌روند و این سهمیه مصرف نمی‌شود.": {"ar": "إذا حفظت مفتاحك الخاص، تُرسل الطلبات بمفتاحك ولا يُستهلك هذا الحد المجاني.", "es": "Si guardas tu propia clave, las solicitudes usan tu clave y no se consume esta cuota.", "tr": "Kendi anahtarını kaydedersen istekler senin anahtarınla gider ve bu kota kullanılmaz.", "fr": "Si vous enregistrez votre propre clé, les requêtes utilisent votre clé et ce quota n'est pas consommé.", "de": "Wenn du deinen eigenen Schlüssel speicherst, laufen Anfragen über deinen Schlüssel und dieses Kontingent wird nicht verbraucht."},
    "حساب فعال": {"ar": "حساب نشط", "es": "Cuenta activa", "tr": "Aktif hesap", "fr": "Compte actif", "de": "Aktives Konto"},
    "ورود با ": {"ar": "تسجيل الدخول عبر", "es": "Iniciar sesión con", "tr": "Şununla giriş:", "fr": "Connexion avec", "de": "Anmelden mit"},
    "پرو · ": {"ar": "احترافي ·", "es": "Pro ·", "tr": "Pro ·", "fr": "Pro ·", "de": "Pro ·"},
    " روز مانده": {"ar": "يومًا متبقية", "es": "días restantes", "tr": "gün kaldı", "fr": "jours restants", "de": "Tage übrig"},
    "دانشجو": {"ar": "طالب", "es": "Estudiante", "tr": "Öğrenci", "fr": "Étudiant", "de": "Student"},
    "تیکت‌های من": {"ar": "تذاكري", "es": "Mis tickets", "tr": "Taleplerim", "fr": "Mes tickets", "de": "Meine Tickets"},
    "تیکت جدید": {"ar": "تذكرة جديدة", "es": "Nuevo ticket", "tr": "Yeni talep", "fr": "Nouveau ticket", "de": "Neues Ticket"},
    "خروج": {"ar": "تسجيل الخروج", "es": "Cerrar sesión", "tr": "Çıkış yap", "fr": "Déconnexion", "de": "Abmelden"},
    "آمار من": {"ar": "إحصاءاتي", "es": "Mis estadísticas", "tr": "İstatistiklerim", "fr": "Mes statistiques", "de": "Meine Statistik"},
    "تنظیمات": {"ar": "الإعدادات", "es": "Ajustes", "tr": "Ayarlar", "fr": "Paramètres", "de": "Einstellungen"},
    "یادگیری": {"ar": "التعلّم", "es": "Aprendizaje", "tr": "Öğrenme", "fr": "Apprentissage", "de": "Lernen"},
    "حساب کاربری": {"ar": "الحساب", "es": "Cuenta de usuario", "tr": "Kullanıcı hesabı", "fr": "Compte utilisateur", "de": "Benutzerkonto"},
    "پرداخت": {"ar": "الدفع", "es": "Pago", "tr": "Ödeme", "fr": "Paiement", "de": "Zahlung"},
    "خطا / فنی": {"ar": "خطأ / تقني", "es": "Error / técnico", "tr": "Hata / teknik", "fr": "Erreur / technique", "de": "Fehler / technisch"},
    "ترجمه": {"ar": "الترجمة", "es": "Traducir", "tr": "Çeviri", "fr": "Traduction", "de": "Übersetzung"},
    "دوبله / Live": {"ar": "الدبلجة / Live", "es": "Doblaje / Live", "tr": "Dublaj / Live", "fr": "Doublage / Live", "de": "Synchronisation / Live"},
    "گزارش باگ": {"ar": "تقرير خطأ", "es": "Informe de error", "tr": "Hata bildirimi", "fr": "Rapport de bug", "de": "Fehlerbericht"},
    "سایر": {"ar": "أخرى", "es": "Otro", "tr": "Diğer", "fr": "Autre", "de": "Sonstiges"},
    "لطفاً دوباره وارد شو": {"ar": "يرجى تسجيل الدخول مرة أخرى", "es": "Inicia sesión de nuevo", "tr": "Lütfen tekrar giriş yap", "fr": "Veuillez vous reconnecter", "de": "Bitte melde dich erneut an"},
    "اتصال برقرار نشد": {"ar": "تعذّر الاتصال", "es": "No se pudo conectar", "tr": "Bağlantı kurulamadı", "fr": "Connexion impossible", "de": "Verbindung fehlgeschlagen"},
    "تعداد درخواست زیاد است؛ کمی بعد": {"ar": "عدد الطلبات كبير؛ حاول بعد قليل", "es": "Demasiadas solicitudes; inténtalo en un momento", "tr": "İstek sayısı çok fazla; biraz sonra dene", "fr": "Trop de requêtes ; réessayez dans un instant", "de": "Zu viele Anfragen; versuche es gleich noch einmal"},
    "حداکثر ۵ تیکت باز داری؛ یکی را ببند": {"ar": "يمكنك فتح 5 تذاكر كحد أقصى؛ أغلق واحدة", "es": "Puedes tener hasta 5 tickets abiertos; cierra uno", "tr": "En fazla 5 açık talebin olabilir; birini kapat", "fr": "Vous pouvez avoir jusqu'à 5 tickets ouverts ; fermez-en un", "de": "Du kannst höchstens 5 offene Tickets haben; schließe eines"},
    "موضوع را کامل‌تر بنویس (حداقل ۳ حرف)": {"ar": "اكتب الموضوع بتفصيل أكثر (3 أحرف على الأقل)", "es": "Escribe el tema con más detalle (al menos 3 letras)", "tr": "Konuyu daha ayrıntılı yaz (en az 3 harf)", "fr": "Précisez le sujet (au moins 3 lettres)", "de": "Beschreibe das Thema genauer (mindestens 3 Buchstaben)"},
    "متن را کامل‌تر بنویس": {"ar": "اكتب الرسالة بتفصيل أكثر", "es": "Escribe el mensaje con más detalle", "tr": "Mesajı daha ayrıntılı yaz", "fr": "Rédigez le message plus en détail", "de": "Schreibe die Nachricht ausführlicher"},
    "خطای سرور؛ دوباره امتحان کن": {"ar": "خطأ في الخادم؛ حاول مرة أخرى", "es": "Error del servidor; inténtalo de nuevo", "tr": "Sunucu hatası; tekrar dene", "fr": "Erreur serveur ; réessayez", "de": "Serverfehler; versuche es erneut"},
    "در حال بارگذاری…": {"ar": "جارٍ التحميل…", "es": "Cargando…", "tr": "Yükleniyor…", "fr": "Chargement…", "de": "Wird geladen…"},
    "هنوز تیکتی نداری. اگر مشکلی داری، «تیکت جدید» را بزن.": {"ar": "ليس لديك تذاكر بعد. إن واجهت مشكلة، اضغط «تذكرة جديدة».", "es": "Aún no tienes tickets. Si tienes un problema, pulsa «Nuevo ticket».", "tr": "Henüz talebin yok. Bir sorunun varsa «Yeni talep»e bas.", "fr": "Vous n'avez pas encore de ticket. Si vous avez un problème, cliquez sur « Nouveau ticket ».", "de": "Du hast noch keine Tickets. Wenn du ein Problem hast, klicke auf „Neues Ticket“."},
    "بسته": {"ar": "مغلقة", "es": "Cerrado", "tr": "Kapalı", "fr": "Fermé", "de": "Geschlossen"},
    "باز": {"ar": "مفتوحة", "es": "Abierto", "tr": "Açık", "fr": "Ouvert", "de": "Offen"},
    "دسته‌بندی": {"ar": "التصنيف", "es": "Categoría", "tr": "Kategori", "fr": "Catégorie", "de": "Kategorie"},
    "موضوع": {"ar": "الموضوع", "es": "Asunto", "tr": "Konu", "fr": "Sujet", "de": "Betreff"},
    "شرح مشکل": {"ar": "وصف المشكلة", "es": "Describe el problema", "tr": "Sorunu açıkla", "fr": "Décrivez le problème", "de": "Problem beschreiben"},
    "ارسال تیکت": {"ar": "إرسال التذكرة", "es": "Enviar ticket", "tr": "Talebi gönder", "fr": "Envoyer le ticket", "de": "Ticket senden"},
    "← همه تیکت‌ها": {"ar": "← كل التذاكر", "es": "← Todos los tickets", "tr": "← Tüm talepler", "fr": "← Tous les tickets", "de": "← Alle Tickets"},
    "شما": {"ar": "أنت", "es": "Tú", "tr": "Sen", "fr": "Vous", "de": "Du"},
    "تیم Subify": {"ar": "فريق Subify", "es": "Equipo de Subify", "tr": "Subify ekibi", "fr": "Équipe Subify", "de": "Subify-Team"},
    "ارسال پاسخ": {"ar": "إرسال الرد", "es": "Enviar respuesta", "tr": "Yanıtı gönder", "fr": "Envoyer la réponse", "de": "Antwort senden"},
    "حساب Subify": {"ar": "حساب Subify", "es": "Cuenta de Subify", "tr": "Subify hesabı", "fr": "Compte Subify", "de": "Subify-Konto"},
    "با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.": {"ar": "سجّل الدخول لفتح تذاكر الدعم وتفعيل مزامنة المفردات. تسجيل الدخول اختياري.", "es": "Inicia sesión para abrir tickets de soporte y activar la sincronización de vocabulario. Es opcional.", "tr": "Destek talebi açmak ve kelime eşitlemesini açmak için giriş yap. Giriş isteğe bağlıdır.", "fr": "Connectez-vous pour ouvrir des tickets d'assistance et activer la synchronisation du vocabulaire. La connexion est facultative.", "de": "Melde dich an, um Support-Tickets zu erstellen und die Wortsynchronisierung zu aktivieren. Die Anmeldung ist optional."},
    "اتصال به sub-ify.site": {"ar": "الاتصال بـ sub-ify.site", "es": "Conexión a sub-ify.site", "tr": "sub-ify.site bağlantısı", "fr": "Connexion à sub-ify.site", "de": "Verbindung zu sub-ify.site"},
    "برقرار نشد": {"ar": "فشل", "es": "falló", "tr": "kurulamadı", "fr": "a échoué", "de": "fehlgeschlagen"},
    "برقرار": {"ar": "تم", "es": "establecida", "tr": "kuruldu", "fr": "établie", "de": "hergestellt"},
    "ثبت‌نام": {"ar": "إنشاء حساب", "es": "Registrarse", "tr": "Kayıt ol", "fr": "S'inscrire", "de": "Registrieren"},
    "روشن": {"ar": "تشغيل", "es": "Encendido", "tr": "Açık", "fr": "Activé", "de": "Ein"},
    "ورود اجباری": {"ar": "تسجيل الدخول إلزامي", "es": "Inicio de sesión obligatorio", "tr": "Giriş zorunlu", "fr": "Connexion obligatoire", "de": "Anmeldung erforderlich"},
    "پنل کاربری": {"ar": "لوحة المستخدم", "es": "Panel de usuario", "tr": "Kullanıcı paneli", "fr": "Panneau utilisateur", "de": "Benutzerbereich"},
    "حساب من": {"ar": "حسابي", "es": "Mi cuenta", "tr": "Hesabım", "fr": "Mon compte", "de": "Mein Konto"},
    "افزونه": {"ar": "الإضافة", "es": "Extensión", "tr": "Eklenti", "fr": "Extension", "de": "Erweiterung"},
    "پاسخ / Reply": {"ar": "الرد", "es": "Respuesta", "tr": "Yanıt", "fr": "Réponse", "de": "Antwort"},
    "بانتظار تسجيل دخولك…": {"ar": "بانتظار تسجيل دخولك…", "es": "Esperando a que inicies sesión…", "tr": "Girişini bekliyoruz…", "fr": "En attente de votre connexion…", "de": "Warten auf deine Anmeldung…"},
    " ویدیوی رایگان استفاده شده": {"ar": "فيديو مجاني مستخدم", "es": "videos gratis usados", "tr": "ücretsiz video kullanıldı", "fr": "vidéos gratuites utilisées", "de": "kostenlose Videos genutzt"},
  };
  function gLang() { return document.documentElement.lang || 'fa'; }
  function gDir() { var l = gLang(); return (l === 'fa' || l === 'ar') ? 'rtl' : 'ltr'; }
  function gLoc() { var l = gLang(); return l === 'fa' ? 'fa-IR' : l; }
  // Text for the UI language. Persian is returned as written; the English argument is the fallback.
  function gT(fa, en) {
    var l = gLang();
    if (l === 'fa') return fa;
    if (l === 'en') return en;
    var row = GATE_T[fa], v = row && row[l];
    if (!v) return en;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(fa);
    return m[1] + v + m[3];
  }
  function bi(fa, en) { return '<span dir="' + gDir() + '" data-subify-i18n-ignore style="display:block">' + esc(gT(fa, en)) + '</span>'; }
  document.addEventListener('subify-ui-language', function () { panelKey = ''; gateSig = ''; try { refresh(false); } catch (_) {} });
  function el(tag, css, html) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; }
  function ask(type, extra) {
    return new Promise(function (resolve) {
      try {
        var p = api.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (r) { resolve(r || null); });
        if (p && p.then) p.then(function (r) { resolve(r || null); }, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }
  function openLogin(provider) {
    var url = SITE + '/auth/login.php?provider=' + provider + '&return=' + encodeURIComponent(SITE + '/?ext=1');
    if (api.tabs && api.tabs.create) api.tabs.create({ url: url }); else window.open(url, '_blank', 'noopener');
  }
  function btnCss(primary) {
    return 'display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;min-height:48px;margin:0 0 9px;padding:8px 12px;border-radius:13px;border:1px solid ' +
      (primary ? '#7c5cff' : '#2a3447') + ';background:' + (primary ? '#7c5cff' : '#111621') + ';color:#fff;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer;text-align:center;line-height:1.5';
  }
  function providersOf(state) { return (state && state.providers) || {}; }
  function loginButtons(state, host, onOpen) {
    injectGateStyle();
    var pr = providersOf(state);
    function add(provider, icon, fa, en) {
      var b = el('button', '');
      b.type = 'button';
      b.className = 'sg-btn';
      b.innerHTML = '<span class="sg-ico">' + icon + '</span><span class="sg-txt">' + gbi(fa, en) + '</span>';
      b.addEventListener('click', function () { openLogin(provider); if (onOpen) onOpen(); });
      host.appendChild(b);
    }
    if (pr.google) add('google', GOOGLE_ICON, 'ادامه با Google', 'Continue with Google');
    if (pr.github) add('github', GITHUB_ICON, 'ادامه با GitHub', 'Continue with GitHub');
    if (pr.linkedin) add('linkedin', LINKEDIN_ICON, 'ادامه با LinkedIn', 'Continue with LinkedIn');
  }

  /* ------------------------------------------------------------- sign-in wall */
  var GOOGLE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24z"/><path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.5H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
  var GITHUB_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#111" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  var LINKEDIN_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#0A66C2" d="M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3zM5.3 7.4a2.1 2.1 0 110-4.1 2.1 2.1 0 010 4.1zM7.1 20.5H3.6V9h3.6v11.5zM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 .9.8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0z"/></svg>';
  var GATE_CSS = [
    '#subify-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px 16px;overflow-y:auto;background:radial-gradient(120% 60% at 50% 0%,rgba(124,92,255,.18),transparent 62%),#0b0f17;color:#eef1f8;font:14px/1.7 "VazirUI",Vazirmatn,system-ui,sans-serif;-webkit-font-smoothing:antialiased}',
    '#subify-gate,#subify-gate *{letter-spacing:0!important;word-spacing:normal!important}',
    '#subify-gate .sg-card{width:100%;max-width:348px;text-align:center}',
    '#subify-gate .sg-logo{display:block;width:64px;height:64px;margin:0 auto 14px;border-radius:20px;box-shadow:0 12px 30px rgba(124,92,255,.35)}',
    '#subify-gate h1.sg-title{margin:0 0 8px;font-family:"EstedadUI","VazirUI",sans-serif;font-size:19px!important;font-weight:700;line-height:1.35;color:inherit}',
    '#subify-gate .sg-title .sg-en{font-size:inherit;margin-top:4px}',
    '#subify-gate .sg-desc{margin:0 0 18px;font-size:12.5px;line-height:1.85;color:#9aa6bb}',
    '.sg-fa{display:block;font-family:"VazirUI",Vazirmatn,system-ui,sans-serif}',
    '.sg-en{display:block;font-family:"Inter",system-ui,sans-serif;direction:ltr;line-height:1.5}',
    '.sg-btn{box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;min-height:54px;margin:0 0 10px;padding:9px 14px;border-radius:999px;border:1px solid #2a3447;background:#121927;color:inherit;font:inherit;text-align:start;cursor:pointer;transition:border-color .16s,background-color .16s,transform .08s}',
    '.sg-btn:hover{border-color:rgba(124,92,255,.65);background:#171f30}',
    '.sg-btn:active{transform:scale(.985)}',
    '.sg-btn:focus-visible{outline:2px solid #8b74ff;outline-offset:2px}',
    '.sg-btn:disabled{opacity:.6;cursor:progress}',
    '.sg-txt{display:block;flex:1;min-width:0}',
    '.sg-btn .sg-fa{font-size:14px;font-weight:700;line-height:1.35}',
    '.sg-btn .sg-en{font-size:14px;font-weight:700;margin-top:0;line-height:1.35}',
    '.sg-btn:not(.is-primary) .sg-en{color:#aab3c2}',
    '.sg-ico{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#fff}',
    '.sg-btn.is-primary{justify-content:center;background:#6a4fe6;border-color:#6a4fe6;color:#fff;text-align:center}',
    '.sg-ghost{background:transparent;border-style:dashed;border-color:#34405a;margin-bottom:0}',
    '.sg-ghost .sg-fa{font-size:13px;font-weight:600}',
    '#subify-gate .sg-status{display:flex;align-items:center;justify-content:center;gap:8px;min-height:20px;margin:6px 0 4px;font-size:12px;color:#c3cbdc}',
    '#subify-gate .sg-status:empty{min-height:0;margin:0}',
    '.sg-status-txt{display:block;text-align:start}',
    '.sg-spin{flex:none;width:13px;height:13px;border-radius:50%;border:2px solid rgba(160,140,255,.28);border-top-color:#a994ff;animation:sg-spin .8s linear infinite}',
    '@keyframes sg-spin{to{transform:rotate(360deg)}}',
    '@media (prefers-reduced-motion:reduce){.sg-spin{animation-duration:2.4s}}',
    '#subify-gate .sg-hint{margin:14px 0 0;font-size:11.5px;line-height:1.8;color:#8f9bb0}',
    '.sg-error{margin:0 0 14px;padding:10px 14px;border-radius:12px;border:1px solid #ff6b7a40;background:#ff6b7a1f;color:#ffb3bb;font-size:12.5px;line-height:1.8;text-align:start}',
    ':root[data-theme="light"] .sg-error{color:#b42338;background:#ff6b7a14;border-color:#ff6b7a66}',
    ':root[data-theme="light"] #subify-gate{background:radial-gradient(120% 60% at 50% 0%,rgba(124,92,255,.10),transparent 62%),#f4f7fc;color:#1d2433}',
    ':root[data-theme="light"] #subify-gate .sg-desc,:root[data-theme="light"] #subify-gate .sg-hint,:root[data-theme="light"] #subify-gate .sg-status{color:#5d6777}',
    ':root[data-theme="light"] .sg-btn{background:#fff;border-color:rgba(60,70,95,.18);box-shadow:0 4px 14px rgba(40,55,80,.06)}',
    ':root[data-theme="light"] .sg-btn:not(.is-primary) .sg-en{color:#5d6777}',
    ':root[data-theme="light"] .sg-btn:hover{background:#f7f5ff;border-color:rgba(124,92,255,.55)}',
    ':root[data-theme="light"] .sg-ghost{background:transparent;border-color:rgba(60,70,95,.28);box-shadow:none}',
    ':root[data-theme="light"] .sg-btn.is-primary{background:#6a4fe6;border-color:#6a4fe6;color:#fff}',
    '#subify-gate .sg-btn.sg-ghost.is-primary{background:var(--solid,#6a4fe6)!important;border:1px solid var(--solid,#6a4fe6)!important;box-shadow:none!important}',
    '.sg-divider{display:flex;align-items:center;gap:10px;margin:14px 0 12px;color:#8f9bb0;font-size:11.5px}',
    '.sg-divider:before,.sg-divider:after{content:"";flex:1;height:1px;background:#2a3447}',
    '.sg-pwd{text-align:start}',
    '.sg-field{display:flex;align-items:center;gap:10px;height:50px;padding:0 16px;margin:0 0 10px;border-radius:999px;border:1px solid #2a3447;color:#8f9bb0}',
    '.sg-field:focus-within{border-color:#7c5cff;box-shadow:0 0 0 3px rgba(124,92,255,.16)}',
    '.sg-field svg{flex:none;width:18px;height:18px}',
    '.sg-field input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:14px;direction:ltr;text-align:start}',
    '.sg-primary{display:block;width:100%;height:50px;border:0;border-radius:999px;background:#6a4fe6;color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer}',
    '.sg-primary:disabled{opacity:.45;cursor:default}',
    '.sg-tabs{display:flex;gap:4px;margin:0 0 14px;padding:4px;border-radius:999px;border:1px solid #2a3447;background:#0f1522}',
    '.sg-tab{flex:1;min-width:0;height:38px;border:0;border-radius:999px;background:transparent;color:#aab3c2;font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
    '.sg-tab .sg-en{font-size:11px;font-weight:500}',
    '.sg-tab[aria-selected="true"]{background:#6a4fe6;color:#fff}',
    '.sg-tab:focus-visible{outline:2px solid #8b74ff;outline-offset:2px}',
    '.sg-lbl{display:block;margin:0 6px 6px;font-size:12px;color:#aab3c2;text-align:start}',
    '.sg-fhint{margin:-4px 6px 12px;font-size:11.5px;line-height:1.8;color:#8f9bb0;text-align:start}',
    ':root[data-theme="light"] .sg-field{border-color:rgba(60,70,95,.28);color:#5d6777}',
    ':root[data-theme="light"] .sg-divider{color:#5d6777}',
    ':root[data-theme="light"] .sg-divider:before,:root[data-theme="light"] .sg-divider:after{background:rgba(60,70,95,.22)}',
    ':root[data-theme="light"] .sg-tabs{border-color:rgba(60,70,95,.28);background:#fff}',
    ':root[data-theme="light"] .sg-tab{color:#5d6777}',
    ':root[data-theme="light"] .sg-tab[aria-selected="true"]{background:#6a4fe6;color:#fff}',
    ':root[data-theme="light"] .sg-lbl,:root[data-theme="light"] .sg-fhint{color:#5d6777}'
  ].join('\n');
  function injectGateStyle() {
    if (document.getElementById('subify-gate-style')) return;
    var s = document.createElement('style');
    s.id = 'subify-gate-style';
    s.textContent = GATE_CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  // Translations for the status and offline lines added in this screen (ui-language.js keeps the rest).
  if (window.SubifyUI && typeof window.SubifyUI.register === 'function') window.SubifyUI.register({
    ar: { 'منتظر ورود تو هستیم…': 'بانتظار تسجيل دخولك…', 'در حال بررسی…': 'جارٍ التحقق…', 'اتصال به سرور ورود برقرار نشد': 'تعذّر الوصول إلى خادم تسجيل الدخول', 'اینترنت یا فیلترشکن را بررسی کن.': 'تحقّق من الإنترنت أو VPN.' },
    es: { 'منتظر ورود تو هستیم…': 'Esperando a que inicies sesión…', 'در حال بررسی…': 'Comprobando…', 'اتصال به سرور ورود برقرار نشد': 'No se pudo conectar con el servidor de acceso', 'اینترنت یا فیلترشکن را بررسی کن.': 'Revisa tu conexión o VPN.' },
    tr: { 'منتظر ورود تو هستیم…': 'Girişini bekliyoruz…', 'در حال بررسی…': 'Kontrol ediliyor…', 'اتصال به سرور ورود برقرار نشد': 'Giriş sunucusuna ulaşılamadı', 'اینترنت یا فیلترشکن را بررسی کن.': 'Bağlantını veya VPN’ini kontrol et.' },
    fr: { 'منتظر ورود تو هستیم…': 'En attente de votre connexion…', 'در حال بررسی…': 'Vérification en cours…', 'اتصال به سرور ورود برقرار نشد': 'Impossible de joindre le serveur de connexion', 'اینترنت یا فیلترشکن را بررسی کن.': 'Vérifiez votre connexion ou votre VPN.' },
    de: { 'منتظر ورود تو هستیم…': 'Warte auf deine Anmeldung…', 'در حال بررسی…': 'Wird geprüft…', 'اتصال به سرور ورود برقرار نشد': 'Der Anmeldeserver ist nicht erreichbar', 'اینترنت یا فیلترشکن را بررسی کن.': 'Prüfe deine Verbindung oder dein VPN.' }
  });
  var gateWaiting = false, gateSig = '';
  // Messages for a failed sign-in (the codes come from auth/callback.php; the same texts as the web app).
  var SIGNIN_ERR = {
    denied: ['ورود لغو شد', 'Sign-in was cancelled.'],
    state: ['نشست ورود منقضی شد؛ دوباره تلاش کن.', 'The sign-in session expired: please try again.'],
    config: ['ورود با این روش هنوز تنظیم نشده است.', 'This sign-in method is not set up yet.'],
    closed: ['ورود و ثبت‌نام فعلاً بسته است.', 'Sign-in and sign-up are closed for now.'],
    disabled: ['این حساب مسدود شده است.', 'This account has been blocked.'],
    noemail: ['ایمیل تأییدشده‌ای پیدا نشد؛ ایمیلت را در Google/GitHub تأیید کن.', 'No verified e-mail was found. Verify your e-mail with Google/GitHub first.'],
    provider: ['ارتباط با سرویس ورود برقرار نشد؛ کمی بعد دوباره تلاش کن.', 'Could not reach the sign-in service: try again shortly.'],
    rate: ['تلاش‌های زیاد؛ یک دقیقه صبر کن.', 'Too many attempts: wait a minute.'],
    server: ['مشکلی پیش آمد؛ دوباره تلاش کن.', 'Something went wrong: please try again.']
  };
  // background.js stores the failed sign-in code when the sign-in tab comes back; show it once.
  function showSignInNotice() {
    var store = api.storage && api.storage.local; if (!store) return;
    Promise.resolve(store.get('subifyAuthNotice')).then(function (r) {
      var n = r && r.subifyAuthNotice;
      if (!n || Date.now() - n.at > 15 * 60 * 1000) return;
      var box = document.getElementById('sg-notice'); var msg = SIGNIN_ERR[n.code];
      if (!box || !msg) return;
      box.innerHTML = '<p class="sg-error" role="alert">' + gbi(msg[0], msg[1]) + '</p>';
      Promise.resolve(store.remove('subifyAuthNotice')).catch(function () {});
    }).catch(function () {});
  }
  function gbi(fa, en) {
    var l = gLang(); return '<span class="' + ((l === 'fa' || l === 'ar') ? 'sg-fa' : 'sg-en') + '" dir="' + gDir() + '" data-subify-i18n-ignore>' + esc(gT(fa, en)) + '</span>';
  }
  /* Sign-in with a username (or e-mail) and a password, or a new account. No e-mail code any more.
     One form host; the tab, the typed values and the error live in `pwd` so a re-render keeps them. */
  var PWD_ERR = {
    username_taken: ['این نام کاربری گرفته شده است.', 'That username is already taken.'],
    email_taken: ['این ایمیل قبلاً ثبت شده است.', 'That e-mail is already registered.'],
    username: ['نام کاربری درست نیست. راهنمای زیر فیلد را ببین.', 'The username is not valid. See the hint under the field.'],
    password: ['رمز عبور باید ۸ تا ۱۲۸ نویسه باشد.', 'The password must be 8 to 128 characters.'],
    email: ['ایمیل درست نیست.', 'That e-mail address does not look right.'],
    bad_credentials: ['نام کاربری، ایمیل یا رمز عبور اشتباه است.', 'Wrong username, e-mail or password.'],
    rate: ['تلاش‌های زیاد؛ چند دقیقه صبر کن.', 'Too many attempts. Wait a few minutes.'],
    closed: ['ورود و ثبت‌نام فعلاً بسته است.', 'Sign-in and sign-up are closed for now.'],
    disabled: ['این حساب مسدود شده است.', 'This account has been blocked.'],
    origin: ['درخواست از این مسیر پذیرفته نشد.', 'This request was not accepted.'],
    input: ['اطلاعات ناقص یا نادرست است؛ فیلدها را بررسی کن.', 'Some details are missing or invalid. Check the fields.'],
    size: ['درخواست خیلی بزرگ است.', 'The request is too large.'],
    method: ['درخواست نادرست بود؛ دوباره تلاش کن.', 'The request was malformed. Try again.'],
    action: ['درخواست نادرست بود؛ دوباره تلاش کن.', 'The request was malformed. Try again.'],
    network: ['اتصال به سرور برقرار نشد.', 'Could not reach the sign-in server.'],
    server: ['مشکلی پیش آمد؛ دوباره تلاش کن.', 'Something went wrong. Please try again.']
  };
  var pwd = { tab: 'in', login: '', user: '', mail: '', pass: '', busy: false, error: '' };
  var PWD_USER_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;
  var PWD_MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Persian and Arabic-Indic digits typed into a field become Latin digits.
  function pwdLatin(s) {
    return String(s == null ? '' : s).replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
  }
  function pwdErr(code) {
    var m = PWD_ERR[code] || PWD_ERR.server;
    return gbi(m[0], m[1]);
  }
  function pwdReady() {
    return pwd.tab === 'in' ? !!(pwd.login.trim() && pwd.pass) : !!(pwd.user.trim() && pwd.pass);
  }
  function pwdApi(action, body) {
    return fetch(SITE + '/auth/password.php?action=' + action, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'server' }; }); })
      .then(function (d) {
        if (!d || !d.ok) throw Object.assign(new Error('password'), { code: (d && d.error) || 'server' });
        return d;
      }, function () { throw Object.assign(new Error('network'), { code: 'network' }); });
  }
  function pwdField(id, fa, en, type, value, autocomplete) {
    return '<label class="sg-lbl" for="' + id + '">' + gbi(fa, en) + '</label>' +
      '<div class="sg-field"><input id="' + id + '" type="' + type + '" dir="ltr" autocomplete="' + autocomplete + '" autocapitalize="none" spellcheck="false" aria-label="' + esc(gT(fa, en)) + '" value="' + esc(value) + '"></div>';
  }
  function pwdHtml() {
    injectGateStyle();
    var inTab = pwd.tab === 'in';
    var err = pwd.error ? '<p class="sg-error" role="alert" aria-live="assertive">' + pwd.error + '</p>' : '';
    var tabs = '<div class="sg-tabs" role="tablist">' +
      '<button class="sg-tab" type="button" role="tab" id="sgPwdTabIn" data-tab="in" aria-selected="' + inTab + '" aria-controls="sgPwdForm">' + gbi('ورود', 'Sign in') + '</button>' +
      '<button class="sg-tab" type="button" role="tab" id="sgPwdTabUp" data-tab="up" aria-selected="' + !inTab + '" aria-controls="sgPwdForm">' + gbi('ساخت حساب', 'Create account') + '</button></div>';
    var fields = inTab
      ? pwdField('sgPwdLogin', 'نام کاربری یا ایمیل', 'Username or e-mail', 'text', pwd.login, 'username') +
        pwdField('sgPwdPass', 'رمز عبور', 'Password', 'password', pwd.pass, 'current-password')
      : pwdField('sgPwdUser', 'نام کاربری', 'Username', 'text', pwd.user, 'username') +
        '<p class="sg-fhint">' + gbi('۳ تا ۲۴ نویسه: حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط. با حرف یا عدد شروع کن.', '3 to 24 characters: letters, digits, dot, dash or underscore. Start with a letter or digit.') + '</p>' +
        pwdField('sgPwdPass', 'رمز عبور', 'Password', 'password', pwd.pass, 'new-password') +
        '<p class="sg-fhint">' + gbi('۸ تا ۱۲۸ نویسه.', '8 to 128 characters.') + '</p>' +
        pwdField('sgPwdMail', 'ایمیل (اختیاری)', 'E-mail (optional)', 'email', pwd.mail, 'email') +
        '<p class="sg-fhint">' + gbi('اختیاری است. بعداً برای بازیابی رمز عبورت از آن استفاده می‌کنیم.', 'Optional. We will use it to recover your password later.') + '</p>';
    var label = inTab
      ? (pwd.busy ? gbi('در حال ورود…', 'Signing in…') : gbi('ورود', 'Sign in'))
      : (pwd.busy ? gbi('در حال ساخت حساب…', 'Creating account…') : gbi('ساخت حساب', 'Create account'));
    var btn = '<button class="sg-primary" type="submit"' + (pwd.busy || !pwdReady() ? ' disabled' : '') + '>' + label + '</button>';
    return tabs + '<form id="sgPwdForm" role="tabpanel" novalidate>' + fields + btn + err + '</form>';
  }
  function pwdMount(host) {
    host.innerHTML = pwdHtml();
    pwdBind(host);
  }
  function pwdCall(host, action, body) {
    pwd.busy = true; pwd.error = ''; pwdMount(host);
    pwdApi(action, body).then(function () {
      pwd.busy = false; pwd.pass = '';
      pwdMount(host);
      refresh(true); // the wall goes away once the session is seen
    }, function (e) {
      pwd.busy = false; pwd.error = pwdErr(e.code); pwdMount(host);
    });
  }
  function pwdSubmit(host) {
    if (pwd.busy) return;
    if (pwd.tab === 'in') {
      var login = pwdLatin(pwd.login).trim().toLowerCase();
      if (!login || !pwd.pass) { pwd.error = pwdErr('input'); pwdMount(host); return; }
      pwdCall(host, 'login', { login: login, password: pwd.pass, app: true });
      return;
    }
    var user = pwdLatin(pwd.user).trim().toLowerCase();
    var mail = pwdLatin(pwd.mail).trim().toLowerCase();
    var len = Array.from(pwd.pass).length;
    if (!PWD_USER_RE.test(user)) { pwd.error = pwdErr('username'); pwdMount(host); return; }
    if (len < 8 || len > 128) { pwd.error = pwdErr('password'); pwdMount(host); return; }
    if (mail && !PWD_MAIL_RE.test(mail)) { pwd.error = pwdErr('email'); pwdMount(host); return; }
    var body = { username: user, password: pwd.pass, app: true };
    if (mail) body.email = mail;
    pwdCall(host, 'register', body);
  }
  function pwdBind(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.sg-tab'), function (t) {
      t.addEventListener('click', function () {
        var next = t.getAttribute('data-tab');
        if (pwd.busy || pwd.tab === next) return;
        pwd.tab = next; pwd.error = ''; pwdMount(host);
      });
    });
    var form = host.querySelector('#sgPwdForm');
    if (!form) return;
    var keys = { sgPwdLogin: 'login', sgPwdUser: 'user', sgPwdPass: 'pass', sgPwdMail: 'mail' };
    Object.keys(keys).forEach(function (id) {
      var input = form.querySelector('#' + id);
      if (!input) return;
      input.addEventListener('input', function () {
        pwd[keys[id]] = input.value;
        var b = form.querySelector('button[type="submit"]'); if (b) b.disabled = pwd.busy || !pwdReady();
      });
    });
    Array.prototype.forEach.call(form.querySelectorAll('.sg-field'), function (f) {
      f.addEventListener('click', function (ev) { var i = f.querySelector('input'); if (i && ev.target !== i) i.focus(); });
    });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); pwdSubmit(host); });
  }
  // The sign-in block under the sign-in buttons. `withDivider`: a divider line above it (when there are buttons).
  function pwdBlock(parent, withDivider) {
    if (withDivider) {
      var dv = el('div', '');
      dv.className = 'sg-divider';
      dv.innerHTML = gbi('یا', 'or');
      parent.appendChild(dv);
    }
    var host = el('div', '');
    host.className = 'sg-pwd';
    parent.appendChild(host);
    pwdMount(host);
  }

  function gateSignature(state) {
    if (state && state.offline) return 'offline';
    var pr = providersOf(state);
    return 'signin:' + (pr.google ? 'g' : '') + (pr.github ? 'h' : '') + (pr.linkedin ? 'l' : '');
  }
  function dropWall() {
    if (wallEl) { wallEl.remove(); wallEl = null; }
    if (timer) { clearInterval(timer); timer = null; }
  }
  function removeWall() { dropWall(); gateWaiting = false; gateSig = ''; }
  function setStatus(kind) {
    var st = document.getElementById('sg-status'); if (!st) return;
    if (kind === 'waiting') st.innerHTML = '<span class="sg-spin" aria-hidden="true"></span><span class="sg-status-txt">' + gbi('منتظر ورود تو هستیم…', 'Waiting for you to sign in…') + '</span>';
    else if (kind === 'checking') st.innerHTML = '<span class="sg-spin" aria-hidden="true"></span><span class="sg-status-txt">' + gbi('در حال بررسی…', 'Checking…') + '</span>';
    else st.innerHTML = '';
  }
  function markCheckPrimary() { var b = document.querySelector('#subify-gate .sg-ghost'); if (b) b.classList.add('is-primary'); }
  function wall(state) {
    dropWall();
    injectGateStyle();
    gateSig = gateSignature(state);
    wallEl = el('div', '');
    wallEl.id = 'subify-gate';
    wallEl.setAttribute('role', 'dialog');
    wallEl.setAttribute('aria-modal', 'true');
    wallEl.setAttribute('aria-labelledby', 'sg-title');
    var logo = '<img class="sg-logo" alt="" src="' + esc(api.runtime.getURL ? api.runtime.getURL('icons/icon128.png') : 'icons/icon128.png') + '">';
    var card = el('div', '');
    card.className = 'sg-card';
    if (state && state.offline) {
      card.innerHTML = logo +
        '<h1 class="sg-title" id="sg-title">' + gbi('اتصال به سرور ورود برقرار نشد', 'Could not reach the sign-in server') + '</h1>' +
        '<p class="sg-desc">' + gbi('اینترنت یا فیلترشکن را بررسی کن.', 'Check your connection or VPN.') + '</p>';
      var r = el('button', '');
      r.type = 'button';
      r.className = 'sg-btn is-primary';
      r.innerHTML = '<span class="sg-txt">' + gbi('تلاش دوباره', 'Try again') + '</span>';
      r.addEventListener('click', function () { refresh(true); });
      card.appendChild(r);
    } else {
      var pr = providersOf(state);
      var hasSocial = !!(pr.google || pr.github || pr.linkedin);
      card.innerHTML = logo +
        '<h1 class="sg-title" id="sg-title">' + gbi('برای ادامه وارد شو', 'Sign in to continue') + '</h1>' +
        '<p class="sg-desc">' + gbi('با یکی از روش‌های زیر وارد شو. اگر حساب نداشته باشی، همان‌جا ساخته می‌شود.', 'Choose one of the options below. No account yet? It is created right there.') + '</p>' +
        (state && state.trial ? '<p class="sg-desc">' + gbi('ده منبع رایگان بدون ورود استفاده شد.', 'The 10 free sources without sign-in are used up.') + '</p>' : '') +
        '<div id="sg-notice"></div><div class="sg-actions"></div>' +
        '<div class="sg-status" id="sg-status" role="status" aria-live="polite"></div>' +
        (hasSocial ? '<p class="sg-hint">' + gbi('ورود با Google، GitHub یا LinkedIn در تب جدید باز می‌شود. بعد از پایان، این‌جا «وارد شدم» را بزن.', 'Google, GitHub and LinkedIn sign-in open in a new tab. When you are done, press “I’ve signed in” here.') + '</p>' : '');
      var actions = card.querySelector('.sg-actions');
      loginButtons(state, actions, function () { gateWaiting = true; setStatus('waiting'); markCheckPrimary(); });
      if (hasSocial) {
        var c = el('button', '');
        c.type = 'button';
        c.className = 'sg-btn sg-ghost';
        c.innerHTML = '<span class="sg-txt">' + gbi('وارد شدم؛ بررسی کن', "I've signed in (check)") + '</span>';
        c.addEventListener('click', function () {
          c.disabled = true;
          setStatus('checking');
          refresh(true).then(function () {
            var b = document.querySelector('#subify-gate .sg-ghost'); if (b) b.disabled = false;
            setStatus(gateWaiting ? 'waiting' : '');
          });
        });
        actions.appendChild(c);
        if (gateWaiting) { setStatus('waiting'); markCheckPrimary(); }
      }
      pwdBlock(actions, hasSocial);
    }
    wallEl.appendChild(card);
    document.body.appendChild(wallEl);
    if (!(state && state.offline)) showSignInNotice();
    timer = setInterval(function () { refresh(true); }, 4000);
  }

  /* --------------------------------------------------------- popup account bar */
  function popupBar(user) {
    // Signed in: the account is a round icon button in the popup header, next to the theme switch.
    // The old text bar (name + "پنل کاربری") is gone.
    if (bar) { bar.remove(); bar = null; }
    popupAccountButton(gT('حساب من / My account', 'My account'));
  }
  // Signed out during the trial: the same button, its tooltip says how many free videos are left.
  function popupGuestButton(trial) {
    var used = Number(trial.used) || 0, max = Number(trial.max) || 10;
    popupAccountButton(gT('ورود اختیاری: ', 'Optional sign-in: ') + used + gT(' از ', ' of ') + max + gT(' ویدیوی رایگان استفاده شده', ' free videos used'));
  }
  function popupAccountButton(title) {
    var existing = document.getElementById('subify-account-btn');
    if (existing) { existing.title = title; existing.setAttribute('aria-label', title); return; }
    var theme = document.querySelector('.theme-toggle') || document.getElementById('themeToggle');
    var host = theme ? theme.parentNode : document.querySelector('.header-actions');
    if (!host) return;
    var b = document.createElement('button');
    b.id = 'subify-account-btn';
    b.type = 'button';
    b.className = 'icon-btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    b.addEventListener('click', function () {
      var u = api.runtime.getURL ? api.runtime.getURL('options.html') : 'options.html';
      if (api.tabs && api.tabs.create) api.tabs.create({ url: u }); else window.open(u, '_blank');
    });
    if (theme) host.insertBefore(b, theme.nextSibling); else host.appendChild(b);
  }

  /* ------------------------------------------------------------ options: panel */
  /* The options page is a management panel: the account card lives in its fixed "حساب من" section
     and the connection status in the "افزونه" section. The page's other sections are not moved. */
  var panelKey = '';
  function panelHost() { return document.getElementById('sfy-account-host'); }
  function clearAccountHost() { var h = panelHost(); if (h) h.innerHTML = ''; panelKey = ''; }
  /** both languages on one line (pills and badges) */
  function inl(fa, en) { return '<span dir="' + gDir() + '" data-subify-i18n-ignore>' + esc(gT(fa, en)) + '</span>'; }
  function card(inner) { return el('div', 'padding:14px;border-radius:16px;border:1px solid rgba(124,92,255,.35);background:rgba(124,92,255,.07);margin:0 0 12px'); }

  var TILE_CSS = 'min-height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.035);color:inherit;font:inherit;font-size:12px;cursor:pointer;padding:6px 8px;line-height:1.45;min-width:0';
  function providerLabel(p) { return p === 'github' ? 'GitHub' : (p === 'google' ? 'Google' : ''); }
  // Days left on the Pro plan (0 when there is no active Pro plan). `until` is a unix time in seconds.
  function proDaysLeft(until) { var s = Number(until) || 0; if (!s) return 0; var left = s * 1000 - Date.now(); return left > 0 ? Math.ceil(left / 86400000) : 0; }
  var PRO_DOT = '<i aria-hidden="true" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.22);margin-inline-end:7px;vertical-align:middle"></i>';
  // Free AI allowance: the same numbers as the web app's account page, read from sub-ify.site.
  function aiUsageRows(s) {
    var L = s.limits || {}, F = s.features || {};
    var rows = [
      ['چت و مربی', 'Chat and tutor', L.chat, F.chat],
      ['نگارش', 'Writing', L.writer, F.writer],
      ['نقش‌آفرینی', 'Roleplay', L.roleplay, F.roleplay],
      ['تمرین تلفظ', 'Shadowing', L.shadow, F.shadow],
      ['ترجمه‌ی لغت و کارهای دیگر', 'Word lookups and other', L.other, s.misc_left]
    ];
    return rows.filter(function (r) { return Number(r[2]) > 0; }).map(function (r) {
      var limit = Number(r[2]);
      return { fa: r[0], en: r[1], limit: limit, used: Math.max(0, limit - Number(r[3] || 0)) };
    });
  }
  function aiMeter(used, limit) {
    var pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
    return '<div style="height:6px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden;margin:5px 0 10px"><i style="display:block;height:100%;width:' + pct + '%;background:#8167fb;border-radius:999px"></i></div>';
  }
  function aiRow(fa, en, used, limit) {
    return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;margin-top:8px"><span>' + inl(fa, en) + '</span><b dir="ltr">' + esc(used + ' / ' + limit) + '</b></div>' + aiMeter(used, limit);
  }
  function loadAiUsage(host) {
    fetch(SITE + '/auth/ai.php?action=state', { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!host || !s || s.ok === false) return;
        var now = Date.now(), n = new Date(now);
        var dayReset = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
        var monthReset = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
        var left = Math.max(0, Math.floor((dayReset - now) / 60000));
        var clock = new Date(dayReset).toLocaleTimeString(gLoc(), { hour: '2-digit', minute: '2-digit' });
        var html = '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:14px">' + bi('هوش مصنوعی رایگان', 'Free AI', false) + '</b>' +
          '<span class="sfy-pill ' + (s.enabled ? 'ok' : '') + '" style="font-size:10px">' + inl(s.enabled ? 'فعال' : 'خاموش', s.enabled ? 'On' : 'Off') + '</span></div>';
        if (s.enabled) {
          html += aiRow('منابع این ماه', 'Sources this month', s.used || 0, s.limit || 0);
          html += '<p style="font-size:11.5px;opacity:.75;margin:0 0 6px">' + inl('منبع یک فایل، ویدیو یا جلسه است. بازنشانی اول ماه بعد، ساعت ', 'A source is one file, video or session. Resets on the 1st of next month, at ') + esc(new Date(monthReset).toLocaleTimeString(gLoc(), { hour: '2-digit', minute: '2-digit' })) + '</p>';
          html += '<p style="font-size:11.5px;opacity:.75;margin:10px 0 0">' + inl('امروز', 'Today') + '</p>';
          aiUsageRows(s).forEach(function (r) { html += aiRow(r.fa, r.en, r.used, r.limit); });
          html += '<p style="font-size:11.5px;opacity:.75;margin:10px 0 0">' + inl('بازنشانی امروز ساعت ', 'Resets today at ') + esc(clock) + inl(' به وقت تو، ', ' your time, in ') + esc(String(Math.floor(left / 60))) + inl(' ساعت و ', ' h ') + esc(String(left % 60)) + inl(' دقیقه دیگر', ' min') + '</p>';
          html += '<p style="font-size:11.5px;opacity:.75;margin:6px 0 0">' + inl('اگر کلید خودت را ذخیره کنی، درخواست‌ها با کلید تو می‌روند و این سهمیه مصرف نمی‌شود.', 'If you save your own key, requests use it and this allowance is not used.') + '</p>';
        }
        var card = el('div', 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border)', html);
        host.appendChild(card);
      })
      .catch(function () { /* offline or signed out: no card */ });
  }

  function renderPanel(user) {
    var host = panelHost(); if (!host) return;
    // Re-render only when the account changes: a refresh on focus must not wipe a ticket that is being typed.
    var key = String(user.id || '') + '|' + String(user.email || '');
    if (key === panelKey && host.firstChild) return;
    panelKey = key;
    host.innerHTML = '';
    var prov = providerLabel(user.provider);
    var head = card();
    head.style.cssText = 'padding:18px;border-radius:20px;border:1px solid var(--border);background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018));margin:0 0 12px;min-width:0';
    head.innerHTML = '<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;min-width:0">' +
      '<div style="flex:none;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#7c5cff,#58d8ff);color:#fff;display:grid;place-items:center;font-weight:700;font-size:18px">' + esc((user.name || user.email || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div style="min-width:0;flex:1">' +
        '<b style="display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (proDaysLeft(user.pro) ? PRO_DOT : '') + esc(user.name || user.email) + '</b>' +
        '<span dir="ltr" style="display:block;font-size:11.5px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:start">' + esc(user.email) + '</span>' +
        '<span style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
          '<span class="sfy-pill ok" style="font-size:10px">' + inl('حساب فعال', 'Active account') + '</span>' +
          (prov ? '<span class="sfy-pill" style="font-size:10px">' + inl('ورود با ', 'Signed in with ') + esc(prov) + '</span>' : '') +
          (proDaysLeft(user.pro) ? '<span class="sfy-pill ok" style="font-size:10px">' + inl('پرو · ', 'Pro · ') + esc(String(proDaysLeft(user.pro))) + inl(' روز مانده', ' days left') + '</span>' : '') +
          (user.student && user.student.active ? '<span class="sfy-pill ok" style="font-size:10px">' + inl('دانشجو', 'Student') + '</span>' : '') +
        '</span>' +
      '</div></div>';
    var tiles = el('div', 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px');
    [['tickets', bi('تیکت‌های من', 'My tickets', true)], ['new', bi('تیکت جدید', 'New ticket', true)], ['out', bi('خروج', 'Sign out', true)]].forEach(function (x) {
      var b = el('button', TILE_CSS, x[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (x[0] === 'out') { ask('subify-auth-logout').then(function (s) { apply(s); }); return; }
        view = x[0] === 'new' ? { name: 'new' } : { name: 'list' }; renderView();
      });
      tiles.appendChild(b);
    });
    var links = el('div', 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0 14px');
    [['#statistics', bi('آمار من', 'My statistics', true)], ['#settings', bi('تنظیمات', 'Settings', true)], ['#learning', bi('یادگیری', 'Learning', true)]].forEach(function (x) {
      var b = el('button', TILE_CSS, x[1]);
      b.type = 'button';
      b.addEventListener('click', function () { location.hash = x[0].slice(1); });
      links.appendChild(b);
    });
    head.appendChild(tiles);
    head.appendChild(links);
    host.appendChild(head);
    loadAiUsage(head);
    var body = el('div', ''); body.id = 'subify-panel-body'; host.appendChild(body);
    renderView();
  }

  function setBody(html, node) {
    var body = document.getElementById('subify-panel-body'); if (!body) return null;
    body.innerHTML = html || ''; if (node) body.appendChild(node); return body;
  }
  var CAT = [['account', 'حساب کاربری', 'Account'], ['payment', 'پرداخت', 'Payment'], ['technical', 'خطا / فنی', 'Technical'], ['translation', 'ترجمه', 'Translation'], ['dub', 'دوبله / Live', 'Dub / Live'], ['bug', 'گزارش باگ', 'Bug report'], ['other', 'سایر', 'Other']];
  function catLabel(k) { for (var i = 0; i < CAT.length; i++) if (CAT[i][0] === k) return bi(CAT[i][1], CAT[i][2], true); return esc(k); }
  var ERR = { auth: ['لطفاً دوباره وارد شو', 'Please sign in again'], network: ['اتصال برقرار نشد', 'Connection failed'], rate: ['تعداد درخواست زیاد است؛ کمی بعد', 'Too many requests (try later)'], too_many_open: ['حداکثر ۵ تیکت باز داری؛ یکی را ببند', 'You can have 5 open tickets; close one first'], subject: ['موضوع را کامل‌تر بنویس (حداقل ۳ حرف)', 'Write a longer subject (at least 3 characters)'], body: ['متن را کامل‌تر بنویس', 'Write a little more detail'], server: ['خطای سرور؛ دوباره امتحان کن', 'Server error (try again)'] };
  function errText(code) { var e = ERR[code] || ERR.server; return bi(e[0], e[1], true); }

  function renderView() {
    if (!document.getElementById('subify-panel-body')) return;
    if (view.name === 'list') return showList();
    if (view.name === 'new') return showNew();
    if (view.name === 'thread') return showThread(view.id);
  }
  function showList() {
    setBody('<div style="font-size:12px;opacity:.7;padding:8px 0">' + bi('در حال بارگذاری…', 'Loading…', true) + '</div>');
    ask('subify-tickets-list').then(function (r) {
      if (!r || !r.ok) { setBody('<div style="color:#ff9aa8;font-size:12px;padding:6px 0">' + errText(r && r.error) + '</div>'); return; }
      var html = '<div style="font-size:12.5px;font-weight:700;margin:8px 0 6px">' + bi('تیکت‌های من', 'My tickets', true) + '</div>';
      var list = Array.isArray(r.tickets) ? r.tickets : [];
      if (!list.length) html += '<div style="font-size:12px;opacity:.75;line-height:1.9;padding:6px 0">' + bi('هنوز تیکتی نداری. اگر مشکلی داری، «تیکت جدید» را بزن.', "You have no tickets yet. If something is wrong, press “New ticket”.", true) + '</div>';
      setBody(html);
      var body = document.getElementById('subify-panel-body');
      list.forEach(function (t) {
        var b = el('button', 'display:block;width:100%;text-align:start;padding:10px 12px;margin:0 0 7px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:transparent;color:inherit;font:inherit;cursor:pointer');
        b.type = 'button';
        b.innerHTML = '<span style="display:block;font-weight:700;font-size:13px">' + (t.unread ? '● ' : '') + esc(t.subject) + '</span>' +
          '<span style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:10.5px;opacity:.8">' +
          '<span>' + (t.status === 'closed' ? bi('بسته', 'Closed', true) : bi('باز', 'Open', true)) + '</span>' +
          '<span>' + catLabel(t.category).replace(/<span dir="[a-z]+"[^>]*>/, '').replace('</span>', '') + '</span>' +
          '<span dir="ltr">' + new Date(t.updatedAt * 1000).toISOString().slice(0, 10) + '</span></span>';
        b.addEventListener('click', function () { view = { name: 'thread', id: t.id }; renderView(); });
        body.appendChild(b);
      });
    });
  }
  function showNew() {
    var f = el('div', '');
    f.innerHTML = '<div style="font-size:12.5px;font-weight:700;margin:8px 0 8px">' + bi('تیکت جدید', 'New ticket', true) + '</div>' +
      '<label style="display:block;font-size:11.5px;margin:0 0 4px">' + bi('دسته‌بندی', 'Category', true) + '</label>' +
      '<select id="sfyTkCat" style="width:100%;height:38px;border-radius:10px;margin-bottom:10px;padding:0 8px;font:inherit;font-size:12.5px">' +
      CAT.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + ' · ' + esc(c[2]) + '</option>'; }).join('') + '</select>' +
      '<label style="display:block;font-size:11.5px;margin:0 0 4px">' + bi('موضوع', 'Subject', true) + '</label>' +
      '<input id="sfyTkSub" maxlength="120" style="width:100%;height:38px;border-radius:10px;margin-bottom:10px;padding:0 10px;font:inherit;font-size:12.5px">' +
      '<label style="display:block;font-size:11.5px;margin:0 0 4px">' + bi('شرح مشکل', 'Details', true) + '</label>' +
      '<textarea id="sfyTkBody" maxlength="4000" rows="6" style="width:100%;border-radius:10px;padding:9px 10px;font:inherit;font-size:12.5px;resize:vertical"></textarea>' +
      '<div id="sfyTkErr" style="color:#ff9aa8;font-size:12px;margin:8px 0 0"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button id="sfyTkSend" type="button" style="' + btnCss(true).replace('width:100%;', 'flex:1;') + '">' + bi('ارسال تیکت', 'Send ticket') + '</button></div>';
    setBody('', f);
    f.querySelector('#sfyTkSend').addEventListener('click', function () {
      var sub = f.querySelector('#sfyTkSub').value.trim(), txt = f.querySelector('#sfyTkBody').value.trim(), cat = f.querySelector('#sfyTkCat').value;
      var err = f.querySelector('#sfyTkErr'); err.innerHTML = '';
      if (sub.length < 3) { err.innerHTML = errText('subject'); return; }
      if (txt.length < 5) { err.innerHTML = errText('body'); return; }
      if (busy) return; busy = true;
      ask('subify-tickets-create', { subject: sub, category: cat, body: txt }).then(function (r) {
        busy = false;
        if (!r || !r.ok) { err.innerHTML = errText(r && r.error); return; }
        view = { name: 'thread', id: r.id }; renderView();
      });
    });
  }
  function showThread(id) {
    setBody('<div style="font-size:12px;opacity:.7;padding:8px 0">' + bi('در حال بارگذاری…', 'Loading…', true) + '</div>');
    ask('subify-tickets-get', { id: id }).then(function (r) {
      if (!r || !r.ok) { setBody('<div style="color:#ff9aa8;font-size:12px">' + errText(r && r.error) + '</div>'); return; }
      var t = r.ticket;
      var html = '<button id="sfyTkBack" type="button" style="border:0;background:none;color:inherit;font:inherit;font-size:12px;padding:6px 0;cursor:pointer;text-decoration:underline">' + bi('← همه تیکت‌ها', '← All tickets', true) + '</button>' +
        '<div style="font-size:13.5px;font-weight:700;margin:4px 0 2px">' + esc(t.subject) + '</div>' +
        '<div style="font-size:11px;opacity:.7;margin-bottom:10px">' + catLabel(t.category).replace('</span>', '</span>') + ' · ' + (t.status === 'closed' ? bi('بسته', 'Closed', true) : bi('باز', 'Open', true)) + '</div>';
      r.messages.forEach(function (m) {
        var mine = m.author === 'user';
        html += '<div style="margin:0 0 8px;padding:9px 11px;border-radius:12px;background:' + (mine ? 'rgba(255,255,255,.06)' : 'rgba(124,92,255,.14)') + ';margin-' + (mine ? 'inline-start' : 'inline-end') + ':18px">' +
          '<div style="font-size:10.5px;opacity:.7;margin-bottom:4px">' + (mine ? bi('شما', 'You', true) : bi('تیم Subify', 'Subify team', true)) + ' · <span dir="ltr">' + new Date(m.createdAt * 1000).toISOString().slice(0, 16).replace('T', ' ') + '</span></div>' +
          '<div style="font-size:12.5px;line-height:1.9;white-space:pre-wrap">' + esc(m.body) + '</div></div>';
      });
      html += '<textarea id="sfyTkReply" maxlength="4000" rows="3" placeholder="' + esc(gT('پاسخ / Reply', 'Reply')) + '" style="width:100%;border-radius:10px;padding:9px 10px;font:inherit;font-size:12.5px;margin-top:6px;resize:vertical"></textarea>' +
        '<div id="sfyTkErr" style="color:#ff9aa8;font-size:12px;min-height:14px;margin:4px 0"></div>' +
        '<button id="sfyTkSendReply" type="button" style="' + btnCss(true) + '">' + bi('ارسال پاسخ', 'Send reply') + '</button>';
      var node = el('div', ''); node.innerHTML = html; setBody('', node);
      node.querySelector('#sfyTkBack').addEventListener('click', function () { view = { name: 'list' }; renderView(); });
      node.querySelector('#sfyTkSendReply').addEventListener('click', function () {
        var txt = node.querySelector('#sfyTkReply').value.trim(); var err = node.querySelector('#sfyTkErr');
        if (txt.length < 1) { err.innerHTML = errText('body'); return; }
        if (busy) return; busy = true;
        ask('subify-tickets-reply', { id: id, body: txt }).then(function (rr) { busy = false; if (!rr || !rr.ok) { err.innerHTML = errText(rr && rr.error); return; } showThread(id); });
      });
    });
  }

  /* ------------------------------------------------------ options: signed out */
  function signedOutCard(state) {
    var host = panelHost(); if (!host) return;
    host.innerHTML = '';
    var c = card();
    c.innerHTML = '<div style="font-size:14px;font-weight:700;margin-bottom:4px">' + bi('حساب Subify', 'Subify account') + '</div>' +
      '<div style="font-size:12px;line-height:1.9;opacity:.8;margin-bottom:10px">' + bi('با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.', 'Sign in to open support tickets and sync your words. Sign-in is optional.', true) + '</div>';
    var pr = providersOf(state);
    var hasSocial = !!(pr.google || pr.github || pr.linkedin);
    if (hasSocial) loginButtons(state, c);
    pwdBlock(c, hasSocial);
    host.appendChild(c);
  }

  /* ------------------------------------------------------------- state machine */
  function apply(state) {
    if (!state) return;
    lastUser = state.user || null;
    // no-sign-in trial: while the first 10 videos are free, the wall stays down for this video
    var trialOpen = !!(state.trial && state.trial.allowed);
    if (state.required && !state.user && !trialOpen) {
      if (IS_OPTIONS) clearAccountHost();
      if (bar) { bar.remove(); bar = null; }
      var accBtn = document.getElementById('subify-account-btn'); if (accBtn) accBtn.remove();
      if (wallEl && gateSig === gateSignature(state)) return; // same screen: keep it (no flicker, no lost focus)
      wall(state); return;
    }
    removeWall();
    if (IS_OPTIONS) {
      if (state.user) renderPanel(state.user); else { panelKey = ''; signedOutCard(state); }
      renderExtStatus(state);
      // the dashboard (options.js) listens for this and shows the same state without asking again
      document.dispatchEvent(new CustomEvent('subify-auth-state', { detail: state }));
    } else if (state.user) {
      popupBar(state.user);
    } else if (state.required && state.trial) {
      popupGuestButton(state.trial);
    }
  }
  /* Connection rows for the "افزونه" section (one status per line, with a pill). */
  function renderExtStatus(state) {
    var host = document.getElementById('sfy-ext-status'); if (!host || !state) return;
    function row(label, cls, pill) {
      return '<div class="sfy-status-row"><span>' + label + '</span><span class="sfy-pill' + (cls ? ' ' + cls : '') + '">' + pill + '</span></div>';
    }
    var html = row(bi('اتصال به sub-ify.site', 'Connection to sub-ify.site', true), state.offline ? 'bad' : 'ok', state.offline ? inl('برقرار نشد', 'failed') : inl('برقرار', 'ok'));
    if (!state.offline) {
      html += row(bi('ثبت‌نام', 'Sign-up', true), '', state.open ? inl('روشن', 'on') : inl('خاموش', 'off'));
      html += row(bi('ورود اجباری', 'Login required', true), '', state.required ? inl('روشن', 'on') : inl('خاموش', 'off'));
    }
    host.innerHTML = html;
  }

  function refresh(force) { return ask('subify-auth-status', { force: !!force }).then(apply); }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(true); });
  window.addEventListener('focus', function () { refresh(true); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { refresh(false); }); else refresh(false);
})();
