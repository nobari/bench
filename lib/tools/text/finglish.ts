/**
 * Finglish (Persian written with Latin letters — a.k.a. Pinglish) → Persian
 * script.
 *
 * Finglish is lossy: short vowels are unwritten in Persian, and one Latin
 * letter can stand for several Persian letters (s → س/ص/ث, z → ز/ذ/ض/ظ,
 * t → ت/ط, h → ه/ح, gh → غ/ق, a → fatha/ا/آ). So every word goes through, in
 * order: (1) a dictionary of common words and names, (2) a verb engine that
 * understands prefixes (mi-, nemi-, be-, na-), stems and personal endings,
 * (3) affix stripping (plurals, possessives, comparatives) on dictionary
 * stems, and (4) a phonetic rule fallback. Every stage also yields
 * alternatives so a UI can offer tap-to-fix spellings. Runs entirely locally.
 */

export const ZWNJ = "\u200C";

export interface FinglishWord {
  /** The Latin token as typed. */
  source: string;
  /** Best-guess Persian spelling. */
  best: string;
  /** Alternatives, best first, de-duplicated. */
  candidates: string[];
  /** True when the dictionary, verb engine or affix rules recognised it. */
  known: boolean;
}

export interface FinglishToken {
  kind: "word" | "text";
  /** Persian (for words: the best candidate) or pass-through text. */
  text: string;
  word?: FinglishWord;
}

export interface FinglishOptions {
  /** Join prefixes/suffixes with a zero-width non-joiner (نیم‌فاصله). Default true. */
  zwnj?: boolean;
  /** Convert digits and , ; ? to their Persian forms. Default true. */
  persianDigits?: boolean;
}

/* ------------------------------------------------------------ normalisation */

/**
 * Canonical phonemic key for a Finglish word. Digraphs collapse to one
 * symbol (kh→x, gh→q, ch→C, sh→S, zh→Z), long vowels to A/i/u, doubled
 * consonants to one. Case-insensitive.
 */
export function normalizeFinglish(raw: string): string {
  let w = raw.normalize("NFC").toLowerCase();
  w = w
    .replace(/[âāãáàä]/g, "A")
    .replace(/š/g, "S")
    .replace(/č/g, "C")
    .replace(/ž/g, "Z")
    .replace(/[ūúùü]/g, "u")
    .replace(/[īíì]/g, "i")
    .replace(/[êéèë]/g, "e")
    .replace(/[ôóòö]/g, "o")
    .replace(/[‘’`´]/g, "'");
  w = w
    .replace(/kh/g, "x")
    .replace(/gh/g, "q")
    .replace(/ch/g, "C")
    .replace(/sh/g, "S")
    .replace(/zh/g, "Z")
    .replace(/ph/g, "f");
  w = w.replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/w/g, "v");
  w = w
    .replace(/aa/g, "A")
    .replace(/ee/g, "i")
    .replace(/ii/g, "i")
    .replace(/oo/g, "u")
    .replace(/ou/g, "u")
    .replace(/uu/g, "u")
    .replace(/ei/g, "ey")
    .replace(/ai/g, "ay")
    .replace(/iy(?=[aAeiou])/g, "i");
  w = w.replace(/([bpstjChxdzrZSfqkglmnvy'])\1+/g, "$1");
  w = w.replace(/([^aAeiou])y$/, "$1i");
  return w;
}

/** Looser key: ignores the long/short a and o/u distinctions (length-preserving). */
function loose(norm: string): string {
  return norm.replace(/A/g, "a").replace(/u/g, "o");
}

function fa(s: string): string {
  return s.replace(/ي/g, "ی").replace(/ك/g, "ک");
}

/* ---------------------------------------------------------------- dictionary */

// `finglish[,finglish…]=persian[|alternative…]` — one entry per line. Keys are
// written in everyday Finglish; they are normalised on load so spelling
// variants (khoob / khub / khob) resolve through the loose index.
const DICT_RAW = `
salam,salaam=سلام
dorood,dorud=درود
khodahafez,khodafez,khodahafes=خداحافظ
khodanegahdar=خدانگهدار
bedrood=بدرود
chetori,chetory=چطوری
chetor=چطور
khoob,khob,khub=خوب
mersi,merci=مرسی
mamnoon,mamnun=ممنون
motshakeram,moteshakeram=متشکرم
tashakor=تشکر
sepas=سپاس
sepasgozaram=سپاسگزارم
lotfan=لطفاً
khahesh=خواهش
ozr=عذر
motasefam=متأسفم
motasef=متأسف
motasefane=متأسفانه
khoshbakhtane=خوشبختانه
bale=بله
areh,are=آره
na=نه
nakheir=نخیر
hatman=حتماً
albate,albatteh,albatte=البته
shayad=شاید
bayad=باید
nabayad=نباید
chie,chiye=چیه
chi=چی
che=چه
chera=چرا
koja=کجا
kojayi,kojaei=کجایی
key=کی
ki=کی
kie,kiye=کیه
kodum,kodoom=کدوم
kodam=کدام
chand=چند
chandta=چندتا
cheghadr,cheghad=چقدر
chejoori,chejuri=چجوری
chegune=چگونه
ke=که
in=این
un,oon=اون
an=آن
inja=اینجا
unja,oonja=اونجا
anja=آنجا
inha=این‌ها
ina=اینا
una,oona=اونا
unha,oonha=اون‌ها
anha=آنها
man=من
to=تو
u,oo=او
ma=ما
shoma=شما
ishan=ایشان
ishun,ishoon=ایشون
khod=خود
ham=هم
hamin=همین
hamun,hamoon=همون
haman=همان
hame=همه
hamechi=همه‌چی
hamechiz=همه‌چیز
hamishe=همیشه
hargez=هرگز
hich=هیچ
hichi=هیچی
hichkas=هیچ‌کس
hichki=هیچ‌کی
hichvaght=هیچ‌وقت
har=هر
harchi=هرچی
harche=هرچه
harkas=هرکس
harki=هرکی
harja=هرجا
harvaght=هروقت
yek,yak=یک
ye=یه
yeki=یکی
do=دو
dota=دوتا
se=سه
seta=سه‌تا
chahar,char=چهار
panj=پنج
shish,shesh=شش
haft=هفت
hasht=هشت
noh=نه
dah=ده
yazdah=یازده
davazdah=دوازده
sizdah=سیزده
chahardah=چهارده
punzdah,panzdah,poonzdah=پانزده
shunzdah,shanzdah,shoonzdah=شانزده
hefdah,hivdah=هفده
hijdah,hejdah=هجده
nuzdah,noozdah=نوزده
bist=بیست
si=سی
chehel=چهل
panjah=پنجاه
shast=شصت
haftad=هفتاد
hashtad=هشتاد
navad=نود
sad=صد|سد
hezar=هزار
milion,million=میلیون
miliard=میلیارد
aval=اول
avalin=اولین
dovom=دوم
sevom=سوم
akhar=آخر
akharin=آخرین
nesf=نصف
nim=نیم
kam=کم
ziad,ziyad=زیاد
kheili,kheyli,khili=خیلی
besyar=بسیار
bishtar=بیشتر
bishtarin=بیشترین
bish=بیش
behtar=بهتر
behtarin=بهترین
badtar=بدتر
emrooz,emruz=امروز
dirooz,diruz=دیروز
farda=فردا
pasfarda=پس‌فردا
parirooz,pariruz=پریروز
emshab=امشب
dishab=دیشب
alan=الان
hala=حالا
badan,ba'dan=بعداً
baad,ba'd=بعد
bad=بد|بعد|باد
ghabl=قبل
ghablan=قبلاً
zood,zud=زود
dir=دیر
vaght=وقت
vaghti=وقتی
saat,sa'at=ساعت
daghighe=دقیقه
sanie=ثانیه
rooz,ruz=روز
shab=شب
sobh=صبح
zohr=ظهر
asr=عصر
hafte=هفته
mah=ماه
sal=سال
emsal=امسال
parsal=پارسال
gahi=گاهی
ba'zi=بعضی
bazi=بازی
shanbe=شنبه
yekshanbe=یکشنبه
doshanbe=دوشنبه
seshanbe=سه‌شنبه
chaharshanbe=چهارشنبه
panjshanbe=پنجشنبه
jome,jom'e=جمعه
farvardin=فروردین
ordibehesht=اردیبهشت
khordad=خرداد
tir=تیر
mordad=مرداد
shahrivar=شهریور
mehr=مهر
aban=آبان
azar=آذر
dey=دی
bahman=بهمن
esfand=اسفند
nowruz,noruz,norooz=نوروز
eid,eyd=عید
mobarak=مبارک
tavalod=تولد
pedar=پدر
madar=مادر
baba=بابا
maman=مامان
baradar=برادر
dadash=داداش
khahar=خواهر
abji=آبجی
pesar=پسر
dokhtar=دختر
bache=بچه
khanevade,khanvade,khanevadeh=خانواده
zan=زن
mard=مرد
shohar=شوهر
hamsar=همسر
amoo,amu=عمو
amme=عمه
dayi=دایی
khale=خاله
pedarbozorg=پدربزرگ
madarbozorg=مادربزرگ
nave=نوه
dust,doost=دوست
rafigh=رفیق
hamkar=همکار
hamsaye=همسایه
aziz=عزیز
azizam=عزیزم
jan=جان
jun,joon=جون
eshgh=عشق
ashegh=عاشق
asheghetam=عاشقتم
del=دل
ghalb=قلب
adam=آدم
ensan=انسان
mardom=مردم
sar=سر
dast=دست
pa=پا
cheshm=چشم
goosh,gush=گوش
dahan=دهان
bini=بینی
mu,moo=مو
surat,soorat=صورت
badane=بدنه
badan=بدن
ghad=قد
shekam=شکم
khune,khoone=خونه
khane,khaneh=خانه
otagh=اتاق
ashpazkhane,ashpazkhoone,ashpazkhune=آشپزخانه|آشپزخونه
hamam,hammam=حمام
dastshooyi,dastshui=دستشویی
madrese=مدرسه
daneshgah=دانشگاه
daneshjoo,daneshju=دانشجو
daneshamooz,daneshamuz=دانش‌آموز
ostad=استاد
moalem,mo'alem=معلم
kelas=کلاس
dars=درس
ketab=کتاب
daftar=دفتر
edare=اداره
sherkat=شرکت
kar=کار
shoghl=شغل
bazar=بازار
maghaze=مغازه
foroshgah,forushgah=فروشگاه
restoran=رستوران
kafe=کافه
bimarestan=بیمارستان
doktor,doctor=دکتر
daroo,daru=دارو
darookhane,darukhane=داروخانه
khiaban,khiyaban,khiabun=خیابان|خیابون
kuche,koche,koocheh=کوچه
shahr=شهر
rusta,roosta=روستا
keshvar=کشور
iran=ایران
irani=ایرانی
tehran=تهران
esfahan=اصفهان
shiraz=شیراز
mashhad=مشهد
tabriz=تبریز
farsi=فارسی
parsi=پارسی
englisi,engilisi=انگلیسی
zaban,zabun,zaboon=زبان|زبون
donya=دنیا
jahan=جهان
zamin=زمین
aseman=آسمان
asemun,asemoon=آسمون
darya=دریا
kooh,kuh=کوه
jangal=جنگل
bagh=باغ
park=پارک
masjed=مسجد
forudgah,foroodgah=فرودگاه
istgah=ایستگاه
mashin=ماشین
otobus,otoboos=اتوبوس
metro=مترو
taxi,taksi=تاکسی
havapeyma=هواپیما
ghatar=قطار
docharkhe=دوچرخه
rah=راه
jade=جاده
pol=پل
dar=در
panjere=پنجره
divar=دیوار
saghf=سقف
miz=میز
sandali=صندلی
takht=تخت
film=فیلم
musighi,musiqi,moosighi=موسیقی
ahang=آهنگ
aks=عکس
gooshi,gushi=گوشی
telefon=تلفن
computer,kampiuter,kamputer=کامپیوتر
internet=اینترنت
email,imeil=ایمیل
pool,pul=پول
toman,tooman,tuman=تومان|تومن
rial=ریال
gheymat,gheimat=قیمت
arzoon,arzun=ارزون
arzan=ارزان
geroon,gerun=گرون
geran=گران
kharid=خرید
forush,foroosh=فروش
ghaza=غذا
nan=نان
noon,nun=نون
ab=آب
chai,chay,chayi=چای
ghahve=قهوه
shir=شیر
berenj=برنج
polo=پلو
kabab=کباب
joje=جوجه
morgh=مرغ
gusht,goosht=گوشت
mahi=ماهی
tokhm=تخم
tokhmemorgh,tokhme morgh=تخم‌مرغ
sabzi=سبزی
mive=میوه
sib=سیب
porteghal=پرتقال
moz=موز
angur,angoor=انگور
hendevane,hendoone,hendune=هندوانه|هندونه
khiar=خیار
goje,gojeh=گوجه
piaz,piyaz=پیاز
sir=سیر
namak=نمک
felfel=فلفل
shekar=شکر
asal=عسل
panir=پنیر
mast=ماست
kare=کره
roghan=روغن
sobhane,sobhune,sobhoone=صبحانه|صبحونه
nahar=ناهار
sham=شام
khoshmaze=خوشمزه
gorosne,gorosneh=گرسنه
goshne=گشنه
teshne=تشنه
nooshidani,nushidani=نوشیدنی
bozorg=بزرگ
koochik,kuchik,kochik=کوچیک
koochak,kuchak=کوچک
boland=بلند
kootah,kutah=کوتاه
ghashang=قشنگ
ziba=زیبا
zesht=زشت
khoshgel=خوشگل
jadid=جدید
ghadimi=قدیمی
ghadim=قدیم
kohne=کهنه
now,no=نو
tamiz=تمیز
kasif=کثیف
garm=گرم
sard=سرد
dagh=داغ
khonak=خنک
sakht=سخت
asan=آسان
asoon,asun=آسون
rahat=راحت
narahat=ناراحت
khoshhal=خوشحال
khosh=خوش
ghamgin=غمگین
asabani=عصبانی
khaste=خسته
mariz=مریض
salem=سالم
salamat=سلامت
salamati=سلامتی
ghavi=قوی
zaif,za'if=ضعیف
tond=تند
aheste,ahesteh=آهسته
yavash=یواش
sari,sari'=سریع
door,dur=دور
nazdik=نزدیک
bala=بالا
payin,paeen,paiin,paein=پایین
chap=چپ
rast=راست
dorost=درست
ghalat=غلط
eshtebah=اشتباه
mohem=مهم
jaleb=جالب
ajib=عجیب
sade=ساده
moshkel=مشکل
vaghean,vaghan,vagheaan=واقعاً
aslan=اصلاً
masalan=مثلاً
taghriban=تقریباً
kamelan=کاملاً
makhsoosan,makhsusan=مخصوصاً
mamoolan,mamulan,ma'mulan=معمولاً
mamooli,mamuli,ma'muli=معمولی
faghat=فقط
tanha=تنها
ali=عالی|علی
tarsnak=ترسناک
bamaze=بامزه
khandedar=خنده‌دار
rangi=رنگی
rang=رنگ
sefid=سفید
siah,siyah=سیاه
meshki=مشکی
ghermez=قرمز
abi=آبی
sabz=سبز
zard=زرد
narenji=نارنجی
banafsh=بنفش
soorati,surati=صورتی
ghahveyi,ghahvei=قهوه‌ای
khakestari=خاکستری
talayi,talaei=طلایی
noghreyi,noghrei=نقره‌ای
va=و
o=و
ba=با
bi=بی
be=به
az=از
ta=تا
ru,roo=رو
ro=رو
ra=را
baraye,baray,bara=برای
baram=برام
barat=برات
barash=براش
baramun,baramoon=برامون
baratun,baratoon=براتون
barashun,barashoon=براشون
vase,vasse=واسه
vali=ولی
ama,amma=اما
agar=اگر
age=اگه
chon=چون
chunke,chonke=چونکه
pas=پس
ya=یا
hamchenin=همچنین
bedune,bedoon,bedun=بدون
joz=جز
bejoz=بجز
zir=زیر
ruye,rooye=روی
tuye,tooye=توی
tu,too=تو
kenar=کنار
pish=پیش
posht=پشت
jelo=جلو
jolo=جلو
aghab=عقب
beyn,bein=بین
miyan=میان
darbare,darbareye=درباره|درباره‌ی
hanooz,hanuz=هنوز
digar=دیگر
dige=دیگه
bazam=بازم
baz=باز
dobare=دوباره
hamintor,hamintour=همین‌طور
intori,intory,intowri=این‌طوری
untori,oontori=اون‌طوری
injoori,injuri=اینجوری
unjoori,oonjoori=اونجوری
ajab=عجب
vay=وای
akh=آخ
eyval,eival=ایول
afarin=آفرین
barikala=باریکلا
damet=دمت
dametgarm=دمت‌گرم
ghorbanat,ghorbanet=قربانت
ghorboonet,ghorbunet=قربونت
fadat=فدات
chakeram=چاکرم
mokhlesam=مخلصم
nokaram=نوکرم
agha=آقا
khanoom,khanum=خانوم
khanom=خانم
jenab=جناب
sarkar=سرکار
mohandes=مهندس
javan=جوان
javoon,javun=جوون
pir=پیر
bia,biya=بیا
biain,biayn=بیاین
boro=برو
naro=نرو
bogu,begu,bego=بگو
nagu,nago=نگو
vaysa,vaisa,vaista=وایسا
ast=است
nistam=نیستم
bekhoda=به‌خدا
khoda=خدا
khodaya=خدایا
enshallah,inshallah,ishala,inshalla=ان‌شاءالله
mashallah,mashala=ماشاءالله
alhamdolellah,alhamdulillah=الحمدلله
bismillah,besmellah=بسم‌الله
salavat=صلوات
namaz=نماز
roze=روزه
ramezan,ramazan=رمضان
khabar=خبر
gol=گل
jigar=جیگر
nafas=نفس
omr=عمر
mano=منو
toro=تورو
ino=اینو
uno,oono=اونو
chio=چیو
kio=کیو
inke=اینکه
magar=مگر
mage=مگه
yani,ya'ni=یعنی
bas=بس
base=بسه
kafi=کافی
mese,mesle=مثل
mesl=مثل
shabih=شبیه
fargh=فرق
lotf=لطف
mohabat,mohabbat=محبت
ehteram=احترام
eftekhar=افتخار
dolat=دولت
siasat,siyasat=سیاست
eghtesad=اقتصاد
elm=علم
honar=هنر
varzesh=ورزش
football,footbal,futbal,fotbal=فوتبال
atash=آتش
khak=خاک
hava=هوا
havas=حواس
baran=باران
barun,baroon=بارون
barf=برف
aftab=آفتاب
khorshid=خورشید
setare=ستاره
sahar=سحر
bahar=بهار
tabestan=تابستان
tabestun,tabestoon=تابستون
paeez,paiz,paeiz=پاییز
zemestan=زمستان
zemestun,zemestoon=زمستون
fasl=فصل
sang=سنگ
derakht=درخت
barg=برگ
gorbe=گربه
sag=سگ
asb=اسب
gav=گاو
gusfand,goosfand=گوسفند
parande=پرنده
mush,moosh=موش
khargush,khargoosh=خرگوش
kabutar,kabootar=کبوتر
lebas=لباس
kafsh=کفش
shalvar=شلوار
pirhan=پیرهن
pirahan=پیراهن
kolah=کلاه
kif=کیف
eynak,einak=عینک
angoshtar=انگشتر
gardanband=گردنبند
rusari,roosari=روسری
manto=مانتو
kot=کت
safar=سفر
mosaferat=مسافرت
belit=بلیت
hotel=هتل
chamedan,chamedun=چمدان|چمدون
pasport=پاسپورت
viza=ویزا
khareji=خارجی
kharej=خارج
dakhel=داخل
birun,biroon=بیرون
modir=مدیر
karmand=کارمند
hoghugh,hoghoogh=حقوق
jalase=جلسه
gozaresh=گزارش
porozhe,project,projeh=پروژه
mohlat=مهلت
emtehan=امتحان
nomre=نمره
ghabul,ghabool=قبول
rad=رد
movafagh=موفق
movafaghiat=موفقیت
talash=تلاش
say,sa'y=سعی
zendegi=زندگی
marg=مرگ
omid=امید
arezoo,arezu=آرزو
khab=خواب
roya,ro'ya=رویا|رؤیا
fekr=فکر
ehsas=احساس
nefrat=نفرت
tars=ترس
shadi=شادی
gham=غم
khande=خنده
gerye=گریه
ashk=اشک
labkhand=لبخند
sokut,sokoot=سکوت
seda=صدا
harf=حرف
kalame=کلمه
jomle=جمله
matn=متن
name=نامه
payam=پیام
message,mesij=مسیج
chat=چت
goftegu,goftegoo=گفتگو
sohbat=صحبت
soal,so'al=سوال|سؤال
javab=جواب
porsesh=پرسش
pasokh=پاسخ
dalil=دلیل
natije=نتیجه
rahehal,rahhal=راه‌حل
komak=کمک
khatar=خطر
amn=امن
amniat,amniyat=امنیت
polis=پلیس
ghanun,ghanoon=قانون
hagh=حق
haghighat=حقیقت
dorugh,doroogh=دروغ
sadegh,sadeq=صادق
amin=امین
mehraban=مهربان
mehrabun,mehraboon=مهربون
khoshakhlagh=خوش‌اخلاق
badakhlagh=بداخلاق
adab=ادب
baadab=باادب
biadab=بی‌ادب
sabr=صبر
sahih=صحیح
sahne=صحنه
sabun,saboon=صابون
sanat,san'at=صنعت
sofre=سفره
sedaghat=صداقت
sorat,sor'at=سرعت
sabet=ثابت
servat=ثروت
talab=طلب
tabiat,tabi'at=طبیعت
tabii,tabi'i=طبیعی
tarh=طرح
taraf=طرف
tarafdar=طرفدار
tarigh=طریق
tul,tool=طول
tulani,toolani=طولانی
tabagh=طبق
tabaghe=طبقه
tanz=طنز
tala=طلا
talagh=طلاق
tufan,toofan=طوفان
tuti,tooti=طوطی
zaher=ظاهر
zolm=ظلم
zarf=ظرف
zarif=ظریف
zarar=ضرر
zaruri,zaroori=ضروری
zarurat,zaroorat=ضرورت
zed=ضد
zamen=ضامن
zaman=زمان
zabt=ضبط
zekr=ذکر
zehn=ذهن
zarre,zare=ذره
zat=ذات
lezat,lezzat=لذت
ghazavat=قضاوت
ghazi=قاضی
ghesmat=قسمت
ghol=قول
ghofl=قفل
ghalam=قلم
ghand=قند
ghesse,ghese=قصه
ghadr=قدر
ghorban,ghorbun,ghorboon=قربان|قربون
gharar=قرار
gharardad=قرارداد
gharz=قرض
ghest=قسط
ghadam=قدم
ghatl=قتل
ghati=قاطی
gharb=غرب
gharib=غریب
ghorub,ghoroob=غروب
ghazal=غزل
ghayeb=غایب
ghar=غار
ghurbaghe,ghoorbaghe=قورباغه
ghorur,ghoroor=غرور
sharm=شرم
hal=حال
halat=حالت
hatta=حتی
hazer=حاضر
hafez=حافظ
hafeze=حافظه
hesab=حساب
hess,hes=حس
hokm=حکم
hokumat,hokoomat=حکومت
hamle=حمله
harekat=حرکت
hazf=حذف
hozur,hozoor=حضور
heyvan,heivan=حیوان
heyvun,heyvoon=حیوون
heif,heyf=حیف
hayat=حیاط
hejab=حجاب
hadaghal=حداقل
hadaksar=حداکثر
hads=حدس
hodud,hodood=حدود
halal=حلال
haram=حرام
hosele=حوصله
asr=عصر
ajale=عجله
adalat=عدالت
adad=عدد
adat=عادت
adi=عادی
aghl=عقل
aghide=عقیده
alamat=علامت
alaghe=علاقه
alam=عالم
amal=عمل
amali=عملی
arus,aroos=عروس
arusi,aroosi=عروسی
asab=عصب
asl=اصل
asli=اصلی
azim=عظیم
ejaze=اجازه
elat,ellat=علت
eyb=عیب
ezzat,ezat=عزت
jam,jam'=جمع
jame'e,jamee=جامعه
mani,ma'ni=معنی
malum,maloom,ma'lum=معلوم
mashghul,mashghool=مشغول
mazerat,ma'zerat=معذرت
maruf,maroof,ma'ruf=معروف
sher,she'r=شعر
shaer,sha'er=شاعر
shoar,sho'ar=شعار
shoru,shoroo,shoru'=شروع
edame=ادامه
montazer=منتظر
tamum,tamoom=تموم
tamam=تمام
taajob,ta'ajob=تعجب
tatil,ta'til=تعطیل
tatilat,ta'tilat=تعطیلات
tamir,ta'mir=تعمیر
tarif,ta'rif=تعریف
vaz,vaz'=وضع
vaziat,vaz'iat=وضعیت
vazife=وظیفه
vade,va'de=وعده
rajebe,raje'be=راجع‌به
motalee,motale'e=مطالعه
moghe,moghe'=موقع
mowzu,mozu,mozoo=موضوع
masul,masool,mas'ul=مسئول
masuliat,masooliat=مسئولیت
taghir,taghyir=تغییر
tavajoh=توجه
tozih=توضیح
tasmim=تصمیم
tasavor=تصور
tasvir=تصویر
taghsir=تقصیر
tarikh=تاریخ
tarjome=ترجمه
tarbiat=تربیت
tajrobe=تجربه
tahghigh=تحقیق
tahamol=تحمل
tashkil=تشکیل
mesal=مثال
asar=اثر
aksar=اکثر
hadese=حادثه
bahs=بحث
ers=ارث
hadis=حدیث
khat,khatt=خط
khata=خطا
vasat=وسط
vatan=وطن
shart=شرط
sharayet=شرایط
ghat,ghat'=قطع
ghatre=قطره
ehtiat=احتیاط
batel=باطل
mantaghe=منطقه
manteghi=منطقی
manzur,manzoor=منظور
nazar=نظر
nazm=نظم
nezam=نظام
entezar=انتظار
lahze=لحظه
hefz=حفظ
mohit=محیط
ertebat=ارتباط
rabete=رابطه
sath=سطح
satr=سطر
matab=مطب
matlab=مطلب
motmaen,motma'en=مطمئن
tanab=طناب
ghaleb=قالب
zarb=ضرب
zarbe=ضربه
zamanat=ضمانت
zemn=ضمن
zemnan=ضمناً
hazm=هضم
razi=راضی
rezayat=رضایت
marz=مرز
arz=عرض
arze=عرضه
farz=فرض
ezafe=اضافه
ezafi=اضافی
tazmin=تضمین
tazad=تضاد
zalem=ظالم
lafz=لفظ
estefade=استفاده
khoshgozasht=خوش‌گذشت
narm=نرم
tang=تنگ
delam=دلم
yad=یاد
hedie,hedye,hediye=هدیه
ok,okey,oki=اوکی
bay,bye=بای
mohammad,mohamad=محمد
hossein,hosein,hosseyn=حسین
hasan,hassan=حسن
reza=رضا
mehdi=مهدی
fatemeh,fateme=فاطمه
zahra=زهرا
maryam=مریم
sara=سارا
narges=نرگس
mahsa=مهسا
neda=ندا
nasrin=نسرین
parisa=پریسا
shirin=شیرین
leila,leyla=لیلا
mina=مینا
mona=مونا
elham=الهام
nazanin=نازنین
farzaneh,farzane=فرزانه
golnaz=گلناز
samira=سمیرا
shabnam=شبنم
hamid=حمید
majid=مجید
saeed,saeid,said=سعید
vahid=وحید
navid=نوید
ramin=رامین
pouya,puya,pooya=پویا
kaveh,kave=کاوه
arash=آرش
babak=بابک
bijan=بیژن
dariush,darioush,daryoush=داریوش
farhad=فرهاد
farshid=فرشید
kamran=کامران
mehran=مهران
milad=میلاد
morteza=مرتضی
mostafa=مصطفی
nima=نیما
pedram=پدرام
peyman,peiman=پیمان
sina=سینا
siavash,siyavash=سیاوش
sohrab=سهراب
ehsan=احسان
arman=آرمان
ashkan=اشکان
amir=امیر
abbas=عباس
javad=جواد
jafar,ja'far=جعفر
karim=کریم
rahim=رحیم
rasoul,rasul=رسول
masoud,masud,masood=مسعود
mahmoud,mahmud,mahmood=محمود
ahmad=احمد
taher=طاهر
yousef,yusef,yoosef=یوسف
yaser=یاسر
hamed=حامد
hadi=هادی
kian=کیان
kimia=کیمیا
niloofar,niloufar,nilufar=نیلوفر
yasaman=یاسمن
yasamin,yasmin=یاسمین
hanieh,hanie=هانیه
hoda=هدی
marzieh,marzie=مرضیه
mahnaz=مهناز
nahid=ناهید
parvin=پروین
parvaneh,parvane=پروانه
sepideh,sepide=سپیده
shahla=شهلا
simin=سیمین
tahereh,tahere=طاهره
zeinab,zeynab=زینب
azadeh,azade=آزاده
atefeh,atefe=عاطفه
sepehr=سپهر
soroush,sorush=سروش
shahab=شهاب
shahram=شهرام
shahin=شاهین
behnam=بهنام
behrouz,behruz,behrooz=بهروز
behzad=بهزاد
bahram=بهرام
parsa=پارسا
kourosh,kurosh,koorosh=کوروش
ardeshir=اردشیر
rostam=رستم
nader=نادر
naser=ناصر
iman=ایمان
alireza=علیرضا
mohammadreza=محمدرضا
amirhossein=امیرحسین
hamidreza=حمیدرضا
gholam=غلام
ghasem=قاسم
`;

const DICT = new Map<string, string[]>();
const DICT_LOOSE = new Map<string, string[]>();

function addTo(map: Map<string, string[]>, key: string, values: string[]) {
  const cur = map.get(key);
  if (!cur) map.set(key, [...values]);
  else for (const v of values) if (!cur.includes(v)) cur.push(v);
}

for (const line of DICT_RAW.split("\n")) {
  const t = line.trim();
  if (!t) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  const keys = t.slice(0, eq).split(",");
  const values = t.slice(eq + 1).split("|").map(fa);
  for (const k of keys) {
    const n = normalizeFinglish(k.trim());
    addTo(DICT, n, values);
    addTo(DICT_LOOSE, loose(n), values);
  }
}

/** Number of dictionary head-words (for UI copy). */
export const FINGLISH_DICT_SIZE = DICT.size;

function dictLookup(norm: string): { exact: string[]; loose: string[] } {
  return { exact: DICT.get(norm) ?? [], loose: DICT_LOOSE.get(loose(norm)) ?? [] };
}

/* ------------------------------------------------------------------- verbs */

const PRESENT_RAW = `r=ر g=گ goo=گو gooy=گوی bin=بین khor=خور khoon=خون khaan=خوان nevis=نویس shnav=شنو shenav=شنو shno=شنو fahm=فهم khaa=خوا khaah=خواه toon=تون tavaan=توان baash=باش sh=ش shav=شو sho=شو d=د deh=ده kon=کن zan=زن ar=ار aavar=آور a=ا aay=آی gir=گیر res=رس moon=مون maan=مان shin=شین neshin=نشین zaar=ذار gozaar=گذار doon=دون daan=دان ferest=فرست khar=خر foroosh=فروش poosh=پوش khaab=خواب raghs=رقص dav=دو do=دو oft=افت shekan=شکن shkan=شکن saaz=ساز baaz=باز andaaz=انداز ndaaz=نداز shenaas=شناس shnaas=شناس pors=پرس band=بند bar=بر mir=میر gard=گرد bargard=برگرد shoor=شور kosh=کش kesh=کش khand=خند tars=ترس daar=دار hast=هست nist=نیست ist=ایست paash=پاش riz=ریز baaf=باف dooz=دوز gozar=گذر boos=بوس gaz=گز larz=لرز taab=تاب pazir=پذیر paz=پز kaar=کار yaab=یاب naal=نال gery=گری bakhsh=بخش rav=رو pardaaz=پرداز jang=جنگ chasb=چسب chin=چین sanj=سنج shomaar=شمار shmaar=شمار sooz=سوز taraash=تراش joosh=جوش maal=مال navaaz=نواز ran=ران shekaaf=شکاف bardaar=بردار`;

const PAST_RAW = `raft=رفت goft=گفت did=دید khord=خورد khoond=خوند khaand=خواند nevesht=نوشت shenid=شنید shnid=شنید fahmid=فهمید khaast=خواست toonest=تونست tavaanest=توانست bood=بود shod=شد daad=داد kard=کرد zad=زد oomad=اومد yoomad=یومد aamad=آمد aavard=آورد avord=آورد gereft=گرفت resid=رسید moond=موند maand=ماند neshast=نشست gozaasht=گذاشت gozasht=گذشت doonest=دونست daanest=دانست ferestaad=فرستاد kharid=خرید forookht=فروخت pooshid=پوشید khaabid=خوابید raghsid=رقصید david=دوید oftaad=افتاد shekast=شکست saakht=ساخت baakht=باخت andaakht=انداخت ndaakht=نداخت shenaakht=شناخت shnaakht=شناخت porsid=پرسید bast=بست bord=برد mord=مرد gasht=گشت bargasht=برگشت shost=شست kosht=کشت keshid=کشید khandid=خندید tarsid=ترسید daasht=داشت paashid=پاشید rikht=ریخت baaft=بافت dookht=دوخت boosid=بوسید gazid=گزید larzid=لرزید paziroft=پذیرفت pokht=پخت kaasht=کاشت yaaft=یافت naalid=نالید gerist=گریست bakhshid=بخشید pardaakht=پرداخت jangid=جنگید chasbid=چسبید chid=چید sanjid=سنجید shomord=شمرد shmord=شمرد sookht=سوخت taraashid=تراشید jooshid=جوشید maalid=مالید navaakht=نواخت raand=راند shekaaft=شکافت istaad=ایستاد vaaysaad=وایساد vaysaad=وایساد bardaasht=برداشت bordaasht=برداشت`;

function parseStems(raw: string): { exact: Map<string, string>; loose: Map<string, string> } {
  const exact = new Map<string, string>();
  const ls = new Map<string, string>();
  for (const pair of raw.split(/\s+/)) {
    if (!pair) continue;
    const [k, v] = pair.split("=");
    const n = normalizeFinglish(k);
    exact.set(n, fa(v));
    if (!ls.has(loose(n))) ls.set(loose(n), fa(v));
  }
  return { exact, loose: ls };
}

const PRESENT = parseStems(PRESENT_RAW);
const PAST = parseStems(PAST_RAW);

const PRESENT_END: Record<string, string> = {
  "": "", am: "م", i: "ی", e: "ه", ad: "د", im: "یم", id: "ید", in: "ین", an: "ن", and: "ند",
  m: "م", y: "ی", d: "د", ym: "یم", yn: "ین", yd: "ید", yi: "یی", n: "ن", o: "و",
};
const PAST_END: Record<string, string> = {
  "": "", am: "م", i: "ی", im: "یم", id: "ید", in: "ین", an: "ن", and: "ند",
  e: "ه", eam: "ه‌ام", ey: "ه‌ای", eim: "ه‌ایم", eid: "ه‌اید", eand: "ه‌اند",
};
/** Endings that only make sense after a stem ending in a vowel letter. */
const VOWEL_STEM_END = new Set(["m", "y", "d", "ym", "yn", "yd", "yi", "n"]);
// Whole-stem reading first (shod → شد, not sho+d → شود), then longest ending.
const ALL_ENDINGS = [
  "",
  ...[...new Set([...Object.keys(PRESENT_END), ...Object.keys(PAST_END)])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length),
];

const VERB_PREFIX: [string, string][] = [
  ["barnemi", "برنمی" + ZWNJ],
  ["barmi", "برمی" + ZWNJ],
  ["nemi", "نمی" + ZWNJ],
  ["mi", "می" + ZWNJ],
  ["na", "ن"],
  ["ne", "ن"],
  ["be", "ب"],
  ["bo", "ب"],
  ["bi", "بی"],
  ["", ""],
];
const PAST_OK_PREFIX = new Set(["", "mi", "nemi", "na", "ne", "barmi", "barnemi"]);
const CLITICS: [string, string][] = [
  ["eSun", "شون"], ["eSAn", "شان"], ["emun", "مون"], ["etun", "تون"],
  ["eS", "ش"], ["aS", "ش"], ["et", "ت"], ["at", "ت"], ["S", "ش"], ["t", "ت"],
];

function composeVerb(prefix: string, stem: string, ending: string): string {
  let p = prefix;
  let s = stem;
  if (p.endsWith(ZWNJ)) {
    if (s.startsWith("ا")) {
      // Colloquial vowel-initial stems join directly: میارم, میام, میومد.
      p = p.slice(0, -1);
      if (s.startsWith("او")) s = s.slice(1);
    } else if (s.startsWith("ی")) {
      p = p.slice(0, -1);
      s = s.slice(1);
    }
  } else if (p === "بی") {
    if (s.startsWith("آ")) s = "ا" + s.slice(1);
    else if (s.startsWith("ی")) s = s.slice(1);
  }
  return p + s + ending;
}

function stemEndsWithVowel(stemFa: string): boolean {
  return /[اویآ]$/.test(stemFa);
}

/** All verb readings of a normalised word, exact-stem matches first. */
function parseVerb(norm: string): string[] {
  const out: string[] = [];
  const tryWord = (w: string, clitic: string) => {
    for (const [pre, preFa] of VERB_PREFIX) {
      if (!w.startsWith(pre)) continue;
      const rest = w.slice(pre.length);
      if (!rest) continue;
      for (const end of ALL_ENDINGS) {
        if (end && !rest.endsWith(end)) continue;
        const stem = end ? rest.slice(0, -end.length) : rest;
        if (!stem) continue;
        for (const pass of ["exact", "loose"] as const) {
          const key = pass === "exact" ? stem : loose(stem);
          // present
          if (end in PRESENT_END) {
            const sfa = PRESENT[pass].get(key);
            if (
              sfa !== undefined &&
              !(stem.length === 1 && !pre && end.length < 2) &&
              !(stem.length === 1 && end === "") &&
              !(VOWEL_STEM_END.has(end) && !stemEndsWithVowel(sfa)) &&
              !(pre === "bi" && !/^[اآی]/.test(sfa))
            ) {
              const v = composeVerb(preFa, sfa, PRESENT_END[end]) + clitic;
              if (!out.includes(v)) out.push(v);
            }
          }
          // past
          if (end in PAST_END && PAST_OK_PREFIX.has(pre)) {
            const sfa = PAST[pass].get(key);
            if (sfa !== undefined) {
              const v = composeVerb(preFa, sfa, PAST_END[end]) + clitic;
              if (!out.includes(v)) out.push(v);
            }
          }
        }
      }
    }
  };
  tryWord(norm, "");
  if (out.length === 0) {
    for (const [c, cfa] of CLITICS) {
      if (norm.length > c.length + 1 && norm.endsWith(c)) {
        tryWord(norm.slice(0, -c.length), cfa);
        if (out.length) break;
      }
    }
  }
  return out;
}

/* ----------------------------------------------------------------- affixes */

type Join = "zwnj" | "plain" | "vowel";
// Keys are in *loose* normalised form (a for a/A, o for o/u) and matched
// against loose(word), so "ketabha", "ketabhaa" and "ketabhâ" all decompose.
const SUFFIXES: [string, string, Join][] = [
  ["haye", "های", "zwnj"], ["hayi", "هایی", "zwnj"], ["haSon", "هاشون", "zwnj"], ["haSan", "هاشان", "zwnj"],
  ["hamon", "هامون", "zwnj"], ["haton", "هاتون", "zwnj"], ["haS", "هاش", "zwnj"], ["ham", "هام", "zwnj"],
  ["hat", "هات", "zwnj"], ["ha", "ها", "zwnj"],
  ["tarin", "ترین", "zwnj"], ["tar", "تر", "zwnj"],
  ["emon", "مون", "vowel"], ["eman", "مان", "vowel"], ["eton", "تون", "vowel"], ["etan", "تان", "vowel"],
  ["eSon", "شون", "vowel"], ["eSan", "شان", "vowel"], ["etam", "تم", "vowel"],
  ["mon", "مون", "plain"], ["man", "مان", "plain"], ["ton", "تون", "plain"], ["tan", "تان", "plain"],
  ["Son", "شون", "plain"], ["San", "شان", "plain"],
  ["and", "ند", "vowel"], ["am", "م", "vowel"], ["at", "ت", "vowel"], ["et", "ت", "vowel"],
  ["aS", "ش", "vowel"], ["eS", "ش", "vowel"], ["im", "یم", "vowel"], ["id", "ید", "vowel"],
  ["in", "ین", "vowel"], ["an", "ن", "vowel"], ["ey", "ای", "vowel"], ["ye", "ی", "vowel"],
  ["yi", "یی", "plain"], ["i", "ی", "vowel"], ["e", "ه", "vowel"], ["o", "و", "vowel"],
  ["m", "م", "plain"], ["t", "ت", "plain"], ["S", "ش", "plain"], ["y", "ی", "plain"],
  ["gari", "گری", "plain"], ["gar", "گر", "plain"], ["dan", "دان", "plain"], ["don", "دون", "plain"],
  ["estan", "ستان", "plain"], ["stan", "ستان", "plain"], ["mand", "مند", "zwnj"], ["nak", "ناک", "plain"],
];
const AFFIX_PREFIX: [string, string, Join][] = [
  ["bi", "بی", "zwnj"], ["na", "نا", "plain"], ["ba", "با", "plain"],
];

function joinSuffix(stemFa: string, suf: string, sufFa: string, join: Join, restoredE: boolean): string {
  const endsHe = stemFa.endsWith("ه");
  const endsVowel = /[اوی]$/.test(stemFa);
  if (join === "zwnj") return stemFa + ZWNJ + sufFa;
  if (join === "plain") {
    if (suf === "yi" && endsHe) return stemFa + ZWNJ + "ای";
    return stemFa + sufFa;
  }
  // vowel-initial suffixes
  if (restoredE) return stemFa.slice(0, -1) + sufFa; // khunam → خونم
  if (endsHe) {
    if (suf === "i" || suf === "ey") return stemFa + ZWNJ + "ای";
    if (suf === "e" || suf === "ye") return stemFa + ZWNJ + "ی";
    if (suf === "o") return stemFa + ZWNJ + "رو";
    return stemFa + ZWNJ + "ا" + sufFa;
  }
  if (endsVowel) {
    if (suf === "i") return stemFa + "یی";
    if (suf === "e" || suf === "ye") return stemFa + "ی";
    if (suf === "am" || suf === "at" || suf === "et" || suf === "aS" || suf === "eS") return stemFa + "ی" + sufFa;
  }
  return stemFa + sufFa;
}

function lookupStem(stem: string): string[] {
  const d = dictLookup(stem);
  return d.exact.length ? d.exact : d.loose;
}

/** Prefix/suffix decompositions on dictionary stems. */
function parseAffixes(norm: string): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    if (!out.includes(v)) out.push(v);
  };
  const withSuffix = (w: string, wrap: (s: string) => string) => {
    const lw = loose(w);
    for (const [suf, sufFa, join] of SUFFIXES) {
      if (!lw.endsWith(suf) || w.length <= suf.length) continue;
      const stem = w.slice(0, -suf.length);
      if (join === "plain" && /[aAeiou]$/.test(stem) === false && ["m", "t", "S", "y", "yi"].includes(suf)) continue;
      let stems = lookupStem(stem);
      let restoredE = false;
      if (!stems.length && join === "vowel" && !stem.endsWith("e")) {
        // khunam → khune + am (final e of the stem is swallowed in speech)
        stems = lookupStem(stem + "e").filter((s) => s.endsWith("ه"));
        restoredE = stems.length > 0;
      }
      if (!stems.length && (suf === "et" || suf === "at" || suf === "t")) {
        // dooset → doost + et (stem-final t merges with the suffix)
        stems = lookupStem(stem + "t");
      }
      for (const sfa of stems) push(wrap(joinSuffix(sfa, suf, sufFa, join, restoredE)));
      if (out.length) return;
    }
  };

  withSuffix(norm, (s) => s);
  const ln = loose(norm);
  for (const [pre, preFa, join] of AFFIX_PREFIX) {
    if (!ln.startsWith(pre) || norm.length <= pre.length + 1) continue;
    const rest = norm.slice(pre.length);
    const glue = join === "zwnj" ? ZWNJ : "";
    for (const sfa of lookupStem(rest)) push(preFa + glue + sfa);
    if (!out.length) withSuffix(rest, (s) => preFa + glue + s);
  }
  return out;
}

/* ------------------------------------------------------------ rule fallback */

const CONS: Record<string, string[]> = {
  b: ["ب"], p: ["پ"], t: ["ت", "ط"], s: ["س", "ص", "ث"], j: ["ج"], C: ["چ"], h: ["ه", "ح"],
  x: ["خ"], d: ["د"], z: ["ز", "ذ", "ض", "ظ"], r: ["ر"], Z: ["ژ"], S: ["ش"], f: ["ف"],
  q: ["ق", "غ"], k: ["ک"], g: ["گ"], l: ["ل"], m: ["م"], n: ["ن"], v: ["و"], y: ["ی"],
  "'": ["ع", "ء"],
};

/** Per-character options (default first) for the phonetic fallback. */
function ruleOptions(w: string): string[][] {
  const opts: string[][] = [];
  const n = w.length;
  for (let i = 0; i < n; i++) {
    const c = w[i];
    const first = i === 0;
    const last = i === n - 1;
    const prev = w[i - 1] ?? "";
    const next = w[i + 1] ?? "";
    switch (c) {
      case "A":
        opts.push(first ? ["آ"] : ["ا"]);
        break;
      case "a":
        if (first) opts.push(["ا", "آ"]);
        else if (last) opts.push(["ا", "ه"]);
        else if (next === "h" && i === n - 2) opts.push(["ا", ""]);
        else opts.push(["", "ا"]);
        break;
      case "e":
        opts.push(first ? ["ا"] : last ? ["ه"] : [""]);
        break;
      case "o":
        opts.push(first ? ["ا"] : last ? ["و"] : ["", "و"]);
        break;
      case "i":
        opts.push(first ? ["ای"] : ["ی"]);
        break;
      case "u":
        opts.push(first ? ["او"] : ["و"]);
        break;
      case "h":
        opts.push(last && (prev === "e" || prev === "a") ? ["ه"] : ["ه", "ح"]);
        break;
      default:
        opts.push(CONS[c] ?? [c]);
    }
  }
  return opts;
}

function ruleCandidates(norm: string, max = 12): string[] {
  const opts = ruleOptions(norm);
  const out: string[] = [];
  const push = (v: string) => {
    if (v && !out.includes(v) && out.length < max) out.push(v);
  };
  push(opts.map((o) => o[0]).join(""));
  // Every medial "a" long — for names like Kamran, Sara.
  push(opts.map((o, i) => (norm[i] === "a" && o.includes("ا") ? "ا" : o[0])).join(""));
  for (let i = 0; i < opts.length; i++)
    for (let k = 1; k < opts[i].length; k++)
      push(opts.map((o, j) => (j === i ? o[k] : o[0])).join(""));
  return out;
}

/* ------------------------------------------------------------- public API */

/** Convert one Latin word; returns best guess plus alternatives. */
export function convertFinglishWord(source: string): FinglishWord {
  const norm = normalizeFinglish(source);
  const candidates: string[] = [];
  const push = (v: string) => {
    if (v && !candidates.includes(v)) candidates.push(v);
  };
  const d = dictLookup(norm);
  d.exact.forEach(push);
  const knownAfterDict = candidates.length > 0;
  parseVerb(norm).forEach(push);
  d.loose.forEach(push);
  parseAffixes(norm).forEach(push);
  const known = candidates.length > 0 || knownAfterDict;
  if (norm) ruleCandidates(norm).forEach(push);
  if (!candidates.length) push(source);
  return { source, best: candidates[0], candidates, known };
}

const WORD_RE = /[A-Za-zÀ-ɏ]+(?:['’`´][A-Za-zÀ-ɏ]+)*/g;
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function persianizeText(s: string, on: boolean): string {
  if (!on) return s;
  return s
    .replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)])
    .replace(/\?/g, "؟")
    .replace(/,/g, "،")
    .replace(/;/g, "؛");
}

function applyZwnj(s: string, on: boolean): string {
  return on ? s : s.replace(/‌/g, "");
}

/** Tokenise and convert; words carry their alternatives. */
export function transliterateFinglish(input: string, opts: FinglishOptions = {}): FinglishToken[] {
  const zwnj = opts.zwnj !== false;
  const digits = opts.persianDigits !== false;
  const tokens: FinglishToken[] = [];
  let last = 0;
  for (const m of input.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    if (start > last) tokens.push({ kind: "text", text: persianizeText(input.slice(last, start), digits) });
    const w = convertFinglishWord(m[0]);
    const word: FinglishWord = {
      ...w,
      best: applyZwnj(w.best, zwnj),
      candidates: [...new Set(w.candidates.map((c) => applyZwnj(c, zwnj)))],
    };
    tokens.push({ kind: "word", text: word.best, word });
    last = start + m[0].length;
  }
  if (last < input.length) tokens.push({ kind: "text", text: persianizeText(input.slice(last), digits) });
  return tokens;
}

/** Plain string conversion. */
export function finglishToPersian(input: string, opts: FinglishOptions = {}): string {
  return transliterateFinglish(input, opts)
    .map((t) => t.text)
    .join("");
}
