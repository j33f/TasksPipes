/**
 * Lucide icons (lucide.dev, ISC licence) offered for pipes and task types, besides the app's own (Icon.svelte):
 * each imported on its own, so that only these are bundled. Grouped as the icon picker shows them.
 */
import type { Component } from "svelte";
import LBriefcaseBusiness from "@lucide/svelte/icons/briefcase-business";
import LBuildingComplex from "@lucide/svelte/icons/building-complex";
import LFactory from "@lucide/svelte/icons/factory";
import LStore from "@lucide/svelte/icons/store";
import LHandshake from "@lucide/svelte/icons/handshake";
import LPresentation from "@lucide/svelte/icons/presentation";
import LClipboardList from "@lucide/svelte/icons/clipboard-list";
import LListTodo from "@lucide/svelte/icons/list-todo";
import LKanban from "@lucide/svelte/icons/kanban";
import LListChecks from "@lucide/svelte/icons/list-checks";
import LTimer from "@lucide/svelte/icons/timer";
import LAlarmClock from "@lucide/svelte/icons/alarm-clock";
import LHourglass from "@lucide/svelte/icons/hourglass";
import LCalendarCheck from "@lucide/svelte/icons/calendar-check";
import LCalendarDays from "@lucide/svelte/icons/calendar-days";
import LMilestone from "@lucide/svelte/icons/milestone";
import LTrophy from "@lucide/svelte/icons/trophy";
import LAward from "@lucide/svelte/icons/award";
import LRocket from "@lucide/svelte/icons/rocket";
import LCrown from "@lucide/svelte/icons/crown";
import LUserPlus from "@lucide/svelte/icons/user-plus";
import LUserCheck from "@lucide/svelte/icons/user-check";
import LUsersRound from "@lucide/svelte/icons/users-round";
import LContact from "@lucide/svelte/icons/contact";
import LBaby from "@lucide/svelte/icons/baby";
import LPersonStanding from "@lucide/svelte/icons/person-standing";
import LAccessibility from "@lucide/svelte/icons/accessibility";
import LHandHeart from "@lucide/svelte/icons/hand-heart";
import LFaceSlightlySmiling from "@lucide/svelte/icons/face-slightly-smiling";
import LMessageCircle from "@lucide/svelte/icons/message-circle";
import LMessagesSquare from "@lucide/svelte/icons/messages-square";
import LAtSign from "@lucide/svelte/icons/at-sign";
import LMailOpen from "@lucide/svelte/icons/mail-open";
import LPhoneCall from "@lucide/svelte/icons/phone-call";
import LVideo from "@lucide/svelte/icons/video";
import LMic from "@lucide/svelte/icons/mic";
import LRadio from "@lucide/svelte/icons/radio";
import LNewspaper from "@lucide/svelte/icons/newspaper";
import LRss from "@lucide/svelte/icons/rss";
import LWallet from "@lucide/svelte/icons/wallet";
import LCreditCard from "@lucide/svelte/icons/credit-card";
import LBanknote from "@lucide/svelte/icons/banknote";
import LPiggyBank from "@lucide/svelte/icons/piggy-bank";
import LReceipt from "@lucide/svelte/icons/receipt";
import LCalculator from "@lucide/svelte/icons/calculator";
import LCoins from "@lucide/svelte/icons/coins";
import LLandmark from "@lucide/svelte/icons/landmark";
import LShoppingCart from "@lucide/svelte/icons/shopping-cart";
import LShoppingBag from "@lucide/svelte/icons/shopping-bag";
import LTag from "@lucide/svelte/icons/tag";
import LPercent from "@lucide/svelte/icons/percent";
import LTrendingUp from "@lucide/svelte/icons/trending-up";
import LChartPie from "@lucide/svelte/icons/chart-pie";
import LChartLine from "@lucide/svelte/icons/chart-line";
import LSchool from "@lucide/svelte/icons/school";
import LLibrary from "@lucide/svelte/icons/library";
import LNotebookPen from "@lucide/svelte/icons/notebook-pen";
import LPencilRuler from "@lucide/svelte/icons/pencil-ruler";
import LLanguages from "@lucide/svelte/icons/languages";
import LBrain from "@lucide/svelte/icons/brain";
import LPuzzle from "@lucide/svelte/icons/puzzle";
import LLightbulb from "@lucide/svelte/icons/lightbulb";
import LAtom from "@lucide/svelte/icons/atom";
import LStethoscope from "@lucide/svelte/icons/stethoscope";
import LPill from "@lucide/svelte/icons/pill";
import LHospital from "@lucide/svelte/icons/hospital";
import LHeartPulse from "@lucide/svelte/icons/heart-pulse";
import LActivity from "@lucide/svelte/icons/activity";
import LDumbbell from "@lucide/svelte/icons/dumbbell";
import LBike from "@lucide/svelte/icons/bike";
import LApple from "@lucide/svelte/icons/apple";
import LSalad from "@lucide/svelte/icons/salad";
import LHouse from "@lucide/svelte/icons/house";
import LSofa from "@lucide/svelte/icons/sofa";
import LBed from "@lucide/svelte/icons/bed";
import LLamp from "@lucide/svelte/icons/lamp";
import LWashingMachine from "@lucide/svelte/icons/washing-machine";
import LUtensils from "@lucide/svelte/icons/utensils";
import LCoffee from "@lucide/svelte/icons/coffee";
import LCookingPot from "@lucide/svelte/icons/cooking-pot";
import LShirt from "@lucide/svelte/icons/shirt";
import LDog from "@lucide/svelte/icons/dog";
import LCat from "@lucide/svelte/icons/cat";
import LPawPrint from "@lucide/svelte/icons/paw-print";
import LFlower2 from "@lucide/svelte/icons/flower-2";
import LTrees from "@lucide/svelte/icons/trees";
import LSprout from "@lucide/svelte/icons/sprout";
import LLeaf from "@lucide/svelte/icons/leaf";
import LSun from "@lucide/svelte/icons/sun";
import LCloud from "@lucide/svelte/icons/cloud";
import LSnowflake from "@lucide/svelte/icons/snowflake";
import LUmbrella from "@lucide/svelte/icons/umbrella";
import LGift from "@lucide/svelte/icons/gift";
import LCake from "@lucide/svelte/icons/cake";
import LPartyPopper from "@lucide/svelte/icons/party-popper";
import LEighthNotes from "@lucide/svelte/icons/eighth-notes";
import LGamepad2 from "@lucide/svelte/icons/gamepad-2";
import LCamera from "@lucide/svelte/icons/camera";
import LFilm from "@lucide/svelte/icons/film";
import LPalette from "@lucide/svelte/icons/palette";
import LPaintbrush from "@lucide/svelte/icons/paintbrush";
import LPlane from "@lucide/svelte/icons/plane";
import LCar from "@lucide/svelte/icons/car";
import LBus from "@lucide/svelte/icons/bus";
import LTrainFront from "@lucide/svelte/icons/train-front";
import LShip from "@lucide/svelte/icons/ship";
import LMap from "@lucide/svelte/icons/map";
import LMapPin from "@lucide/svelte/icons/map-pin";
import LCompass from "@lucide/svelte/icons/compass";
import LLuggage from "@lucide/svelte/icons/luggage";
import LTent from "@lucide/svelte/icons/tent";
import LMountain from "@lucide/svelte/icons/mountain";
import LEarth from "@lucide/svelte/icons/earth";
import LCode from "@lucide/svelte/icons/code";
import LTerminal from "@lucide/svelte/icons/terminal";
import LBug from "@lucide/svelte/icons/bug";
import LGitBranch from "@lucide/svelte/icons/git-branch";
import LGitPullRequest from "@lucide/svelte/icons/git-pull-request";
import LServer from "@lucide/svelte/icons/server";
import LDatabase from "@lucide/svelte/icons/database";
import LCloudUpload from "@lucide/svelte/icons/cloud-upload";
import LCpu from "@lucide/svelte/icons/cpu";
import LMonitor from "@lucide/svelte/icons/monitor";
import LSmartphone from "@lucide/svelte/icons/smartphone";
import LLaptop from "@lucide/svelte/icons/laptop";
import LWifi from "@lucide/svelte/icons/wifi";
import LShieldCheck from "@lucide/svelte/icons/shield-check";
import LKeyRound from "@lucide/svelte/icons/key-round";
import LLockKeyhole from "@lucide/svelte/icons/lock-keyhole";
import LWrench from "@lucide/svelte/icons/wrench";
import LHammer from "@lucide/svelte/icons/hammer";
import LPlug from "@lucide/svelte/icons/plug";
import LBot from "@lucide/svelte/icons/bot";
import LSparkles from "@lucide/svelte/icons/sparkles";
import LZap from "@lucide/svelte/icons/zap";
import LFileText from "@lucide/svelte/icons/file-text";
import LFiles from "@lucide/svelte/icons/files";
import LFolderOpen from "@lucide/svelte/icons/folder-open";
import LPackage from "@lucide/svelte/icons/package";
import LBox from "@lucide/svelte/icons/box";
import LPaperclip from "@lucide/svelte/icons/paperclip";
import LPrinter from "@lucide/svelte/icons/printer";
import LImage from "@lucide/svelte/icons/image";
import LClipboardCheck from "@lucide/svelte/icons/clipboard-check";
import LBookOpen from "@lucide/svelte/icons/book-open";
import LBookmark from "@lucide/svelte/icons/bookmark";
import LScroll from "@lucide/svelte/icons/scroll";
import LCircleCheck from "@lucide/svelte/icons/circle-check";
import LCircleAlert from "@lucide/svelte/icons/circle-alert";
import LTriangleAlert from "@lucide/svelte/icons/triangle-alert";
import LCircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
import LBan from "@lucide/svelte/icons/ban";
import LFlame from "@lucide/svelte/icons/flame";
import LFlagTriangleRight from "@lucide/svelte/icons/flag-triangle-right";
import LEye from "@lucide/svelte/icons/eye";
import LThumbsUp from "@lucide/svelte/icons/thumbs-up";
import LGem from "@lucide/svelte/icons/gem";
import LAnchor from "@lucide/svelte/icons/anchor";
import LInfinity from "@lucide/svelte/icons/infinity";
import LRecycle from "@lucide/svelte/icons/recycle";

export const LUCIDE: Record<string, Component<{ size?: number; strokeWidth?: number }>> = {
  "briefcase-business": LBriefcaseBusiness,
  "building-complex": LBuildingComplex,
  "factory": LFactory,
  "store": LStore,
  "handshake": LHandshake,
  "presentation": LPresentation,
  "clipboard-list": LClipboardList,
  "list-todo": LListTodo,
  "kanban": LKanban,
  "list-checks": LListChecks,
  "timer": LTimer,
  "alarm-clock": LAlarmClock,
  "hourglass": LHourglass,
  "calendar-check": LCalendarCheck,
  "calendar-days": LCalendarDays,
  "milestone": LMilestone,
  "trophy": LTrophy,
  "award": LAward,
  "rocket": LRocket,
  "crown": LCrown,
  "user-plus": LUserPlus,
  "user-check": LUserCheck,
  "users-round": LUsersRound,
  "contact": LContact,
  "baby": LBaby,
  "person-standing": LPersonStanding,
  "accessibility": LAccessibility,
  "hand-heart": LHandHeart,
  "face-slightly-smiling": LFaceSlightlySmiling,
  "message-circle": LMessageCircle,
  "messages-square": LMessagesSquare,
  "at-sign": LAtSign,
  "mail-open": LMailOpen,
  "phone-call": LPhoneCall,
  "video": LVideo,
  "mic": LMic,
  "radio": LRadio,
  "newspaper": LNewspaper,
  "rss": LRss,
  "wallet": LWallet,
  "credit-card": LCreditCard,
  "banknote": LBanknote,
  "piggy-bank": LPiggyBank,
  "receipt": LReceipt,
  "calculator": LCalculator,
  "coins": LCoins,
  "landmark": LLandmark,
  "shopping-cart": LShoppingCart,
  "shopping-bag": LShoppingBag,
  "tag": LTag,
  "percent": LPercent,
  "trending-up": LTrendingUp,
  "chart-pie": LChartPie,
  "chart-line": LChartLine,
  "school": LSchool,
  "library": LLibrary,
  "notebook-pen": LNotebookPen,
  "pencil-ruler": LPencilRuler,
  "languages": LLanguages,
  "brain": LBrain,
  "puzzle": LPuzzle,
  "lightbulb": LLightbulb,
  "atom": LAtom,
  "stethoscope": LStethoscope,
  "pill": LPill,
  "hospital": LHospital,
  "heart-pulse": LHeartPulse,
  "activity": LActivity,
  "dumbbell": LDumbbell,
  "bike": LBike,
  "apple": LApple,
  "salad": LSalad,
  "house": LHouse,
  "sofa": LSofa,
  "bed": LBed,
  "lamp": LLamp,
  "washing-machine": LWashingMachine,
  "utensils": LUtensils,
  "coffee": LCoffee,
  "cooking-pot": LCookingPot,
  "shirt": LShirt,
  "dog": LDog,
  "cat": LCat,
  "paw-print": LPawPrint,
  "flower-2": LFlower2,
  "trees": LTrees,
  "sprout": LSprout,
  "leaf": LLeaf,
  "sun": LSun,
  "cloud": LCloud,
  "snowflake": LSnowflake,
  "umbrella": LUmbrella,
  "gift": LGift,
  "cake": LCake,
  "party-popper": LPartyPopper,
  "eighth-notes": LEighthNotes,
  "gamepad-2": LGamepad2,
  "camera": LCamera,
  "film": LFilm,
  "palette": LPalette,
  "paintbrush": LPaintbrush,
  "plane": LPlane,
  "car": LCar,
  "bus": LBus,
  "train-front": LTrainFront,
  "ship": LShip,
  "map": LMap,
  "map-pin": LMapPin,
  "compass": LCompass,
  "luggage": LLuggage,
  "tent": LTent,
  "mountain": LMountain,
  "earth": LEarth,
  "code": LCode,
  "terminal": LTerminal,
  "bug": LBug,
  "git-branch": LGitBranch,
  "git-pull-request": LGitPullRequest,
  "server": LServer,
  "database": LDatabase,
  "cloud-upload": LCloudUpload,
  "cpu": LCpu,
  "monitor": LMonitor,
  "smartphone": LSmartphone,
  "laptop": LLaptop,
  "wifi": LWifi,
  "shield-check": LShieldCheck,
  "key-round": LKeyRound,
  "lock-keyhole": LLockKeyhole,
  "wrench": LWrench,
  "hammer": LHammer,
  "plug": LPlug,
  "bot": LBot,
  "sparkles": LSparkles,
  "zap": LZap,
  "file-text": LFileText,
  "files": LFiles,
  "folder-open": LFolderOpen,
  "package": LPackage,
  "box": LBox,
  "paperclip": LPaperclip,
  "printer": LPrinter,
  "image": LImage,
  "clipboard-check": LClipboardCheck,
  "book-open": LBookOpen,
  "bookmark": LBookmark,
  "scroll": LScroll,
  "circle-check": LCircleCheck,
  "circle-alert": LCircleAlert,
  "triangle-alert": LTriangleAlert,
  "circle-question-mark": LCircleQuestionMark,
  "ban": LBan,
  "flame": LFlame,
  "flag-triangle-right": LFlagTriangleRight,
  "eye": LEye,
  "thumbs-up": LThumbsUp,
  "gem": LGem,
  "anchor": LAnchor,
  "infinity": LInfinity,
  "recycle": LRecycle,
};

/** The picker's groups: a label (translated by the picker) and the names of its icons. */
export const LUCIDE_GROUPS: { label: string; icons: string[] }[] = [
  { label: "Work", icons: ["briefcase-business", "building-complex", "factory", "store", "handshake", "presentation", "clipboard-list", "list-todo", "kanban", "list-checks", "timer", "alarm-clock", "hourglass", "calendar-check", "calendar-days", "milestone", "trophy", "award", "rocket", "crown"] },
  { label: "People", icons: ["user-plus", "user-check", "users-round", "contact", "baby", "person-standing", "accessibility", "hand-heart", "face-slightly-smiling"] },
  { label: "Communication", icons: ["message-circle", "messages-square", "at-sign", "mail-open", "phone-call", "video", "mic", "radio", "newspaper", "rss"] },
  { label: "Money", icons: ["wallet", "credit-card", "banknote", "piggy-bank", "receipt", "calculator", "coins", "landmark", "shopping-cart", "shopping-bag", "tag", "percent", "trending-up", "chart-pie", "chart-line"] },
  { label: "Learning", icons: ["school", "library", "notebook-pen", "pencil-ruler", "languages", "brain", "puzzle", "lightbulb", "atom"] },
  { label: "Health", icons: ["stethoscope", "pill", "hospital", "heart-pulse", "activity", "dumbbell", "bike", "apple", "salad"] },
  { label: "Home and life", icons: ["house", "sofa", "bed", "lamp", "washing-machine", "utensils", "coffee", "cooking-pot", "shirt", "dog", "cat", "paw-print", "flower-2", "trees", "sprout", "leaf", "sun", "cloud", "snowflake", "umbrella", "gift", "cake", "party-popper", "eighth-notes", "gamepad-2", "camera", "film", "palette", "paintbrush"] },
  { label: "Travel", icons: ["plane", "car", "bus", "train-front", "ship", "map", "map-pin", "compass", "luggage", "tent", "mountain", "earth"] },
  { label: "Tech", icons: ["code", "terminal", "bug", "git-branch", "git-pull-request", "server", "database", "cloud-upload", "cpu", "monitor", "smartphone", "laptop", "wifi", "shield-check", "key-round", "lock-keyhole", "wrench", "hammer", "plug", "bot", "sparkles", "zap"] },
  { label: "Files", icons: ["file-text", "files", "folder-open", "package", "box", "paperclip", "printer", "image", "clipboard-check", "book-open", "bookmark", "scroll"] },
  { label: "Signs", icons: ["circle-check", "circle-alert", "triangle-alert", "circle-question-mark", "ban", "flame", "flag-triangle-right", "eye", "thumbs-up", "gem", "anchor", "infinity", "recycle"] },
];
