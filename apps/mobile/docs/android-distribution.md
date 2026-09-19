# Android 分发：构建、签名与产物

> 目标：把可安装的 Release APK 交给一个不参与开发的人。
> 本文命令在 macOS + JDK 21 + Android SDK 上逐条实测过；任何环境前提见 [README > Android](../README.md#android)。

## 0. 三条命令

```bash
pnpm install
pnpm android:mobile:keystore   # 一次性：在仓库之外生成自用签名密钥
pnpm android:mobile:dist:prod  # 产出 apps/mobile/dist/android/multica-mobile-production-<version>-vc<versionCode>.apk
```

把该 APK 拷进手机（AirDrop / USB / 聊天工具都行）点开安装即可。Android 会问一次「允许从此来源安装应用」，
之后不再限制；**没有 iOS 的 7 天重签**。

---

## 1. 签名密钥

### 1.1 放在哪

| 文件 | 默认路径 | 说明 |
|---|---|---|
| 密钥库 | `~/.multica-android/multica-release.keystore` | PKCS12，RSA 2048，有效期 10000 天 |
| 属性文件 | `~/.multica-android/keystore.properties` | `chmod 600`，含上表的绝对路径与口令 |

两者都在仓库之外，`.gitignore` 另有 `*.keystore` / `*.jks` / `keystore.properties` 三条兜底规则，
防止有人手生成一份放进仓库。

**读取口令**：

```bash
grep storePassword ~/.multica-android/keystore.properties
```

`storePassword` 与 `keyPassword` 是同一个值：PKCS12 密钥库把两者绑定在一起（JDK 9 起的默认类型），
Gradle 也要求一致。

### 1.2 生成

```bash
pnpm android:mobile:keystore
```

口令由 `/dev/urandom` 随机生成后写入属性文件（十六进制，避免转义问题），脚本只打印文件位置与取回方式。
**已存在时脚本拒绝覆盖**，只提示现有文件位置与口令取值方式 —— 换密钥会让已装机的旧包无法覆盖安装
（Android 不允许签名变更的升级），也让将来任何上架上传作废。确实要换（例如密钥在启用前就泄露）才用 `--force`。

**备份**：`~/.multica-android/` 整个目录。丢了这套密钥，就没法再给已经装了本包的手机发可覆盖安装的新版本。

### 1.3 换成团队已有密钥

若已经有海尔商城的正式签名密钥（上架用），不要跑上面的生成脚本，改为把密钥库与属性文件放到任意位置，
然后指向那份属性文件：

```bash
export MULTICA_ANDROID_KEYSTORE_PROPERTIES=/secure/haier-upload/keystore.properties
pnpm android:mobile:dist:prod
```

属性文件格式与 Android 惯例一致，四个键缺一不可，`storeFile` 写绝对路径：

```properties
storeFile=/secure/haier-upload/haier-upload.keystore
storePassword=<口令>
keyAlias=<别名>
keyPassword=<口令>
```

CI 同理：把密钥库与属性文件从 secret 还原到构建机（可以是临时目录），再设这一个环境变量即可。
口令只存在属性文件里，不会进入 `android/` 生成物，也不会出现在命令行参数上。

### 1.4 签名配置怎么注入的

`android/` 是 `expo prebuild` 生成物（已 gitignore），不能手改。签名配置由
[`plugins/with-android-release-signing.js`](../plugins/with-android-release-signing.js) 在每次 prebuild 时
追加到 `android/app/build.gradle` 末尾（两块 `// >>> multica-release-signing` 标记之间），因此：

- 每次构建都是 `expo prebuild` 重新生成 + 重新注入，不依赖模板原文，Expo 升级也不会失配；
- **找不到属性文件时不报错**：release 会退回模板默认的 debug 签名，prebuild 会打一行警告。
  这样没有密钥的人仍能做 debug 构建（`expo prebuild` 是变体无关的，抛错会连带打断 Debug 流程）。
  真正会产出分发物的 `scripts/android-release.sh` 则相反 —— 没有密钥直接退出并给出生成命令。

---

## 2. 构建产物

### 2.1 命令

| 命令 | 变体 | 格式 | 产物 |
|---|---|---|---|
| `pnpm android:mobile:dist` | dev | APK | `dist/android/multica-mobile-dev-<version>-vc<versionCode>.apk` |
| `pnpm android:mobile:dist:staging` | staging | APK | `dist/android/multica-mobile-staging-<version>-vc<versionCode>.apk` |
| `pnpm android:mobile:dist:prod` | production | APK | `dist/android/multica-mobile-production-<version>-vc<versionCode>.apk` |
| `pnpm android:mobile:dist:aab` | dev | AAB | 同名 `.aab` |
| `pnpm android:mobile:dist:staging:aab` | staging | AAB | 同名 `.aab` |
| `pnpm android:mobile:dist:prod:aab` | production | AAB | 同名 `.aab` |

底层是 `assembleRelease`（APK）与 `bundleRelease`（AAB），都不需要连接设备，可以直接在 CI 里跑。
`<version>` / `<versionCode>` 取自 `expo config`（与 prebuild 写入 Gradle 的是同一份配置），
所以产物名不可能与包内实际版本漂移；脚本同时打印包名，便于确认变体。

`<app>` 段固定取 `app.config.ts` 的 `slug`（`multica-mobile`），不是品牌名 —— 文件名保持 ASCII，
不随界面语言变化。

### 2.2 产物位置

`apps/mobile/dist/android/`（`dist/` 已被 gitignore）。APK/AAB 之外，脚本还会打印：

```text
android-release: 产物已就绪 → dist/android/multica-mobile-production-0.1.0-vc1.apk
  package   com.ehaier.zgq.shop.mall
  version   0.1.0 (versionCode 1)
  size      106M
  sha256    <sha256>
  安装      adb install -r dist/android/multica-mobile-production-0.1.0-vc1.apk
```

发文件给别人时带上 sha256 即可核对完整性。

### 2.3 三种变体与包名

| `APP_ENV` | 产物变体段 | 包名 | 应用名 |
|---|---|---|---|
| 未设置（`pnpm android:mobile:dist`） | `dev` | `com.ehaier.zgq.shop.mall.dev` | 海尔商城 (Dev) |
| `staging` | `staging` | `com.ehaier.zgq.shop.mall.staging` | 海尔商城 (Staging) |
| `production` | `production` | `com.ehaier.zgq.shop.mall` | 海尔商城 |

包名彼此不同，所以**三个变体可以同时装在一台手机上**，互不覆盖。production 的包名可用
`EXPO_ANDROID_PACKAGE_PROD` 覆盖（fork 或自建后端时需要，见 `.env.example`），dev / staging 不可覆盖 ——
它们必须保持互不相同。

变体同时决定后端地址：`.env.staging` / `.env.production` 由 `dotenv-cli` 注入，
值在构建时写进内嵌 JS bundle。换后端要重新构建，不是重启 Metro。

**Release 构建保留四套 ABI**（`armeabi-v7a,arm64-v8a,x86,x86_64`），所以一个 APK 能装到任何手机或模拟器上；
只有 Debug 构建会按目标设备收敛 ABI（见 [README > 原生 ABI 收敛](../README.md#原生-abi-收敛debug)）。

---

## 3. 安装

```bash
# 已装过同包名版本，-r 覆盖安装（versionCode 需不小于已装版本）
adb install -r dist/android/multica-mobile-production-0.1.0-vc1.apk
```

不接 USB 的做法：把 APK 传到手机上打开。首次会要求给「文件管理 / 浏览器 / 聊天工具」授予
「安装未知应用」权限，授予后即可安装；这不是应用自身的权限。

AAB **不能直接安装**，它是 Play 的上传格式。将来上架时上传即可；本地要装只能先转换：

```bash
# 需要 bundletool，见 https://github.com/google/bundletool
java -jar bundletool.jar build-apks --bundle=dist/android/multica-mobile-production-0.1.0-vc1.aab \
  --output=dist/android/production.apks --ks="$HOME/.multica-android/multica-release.keystore" \
  --ks-key-alias=multica-release
java -jar bundletool.jar install-apks --apks=dist/android/production.apks
```

---

## 4. 版本管理：`version` 与 `versionCode`

- `version`（`app.config.ts`，当前 `0.1.0`）= 展示给用户看的语义化版本，进 `versionName`。
- `versionCode`（`app.config.ts`，当前 `1`）= 整数，Android 与 Play 用它判断新旧，进 `versionCode`。

**两者刻意不互相派生**：`versionCode` 是字面量，不由 `version` 算出来，这样一次 `version` 提升不会
悄悄改变它的值，反之亦然。

递增规则：

1. 每次要发布一个**新的分发/上传版本**，手工把 `app.config.ts` 的 `android.versionCode` **+1**；
2. 同一个包名不能重复使用已用过的 `versionCode`（Play 会直接拒收；侧载时 Android 会拒绝降级安装）；
3. 只需覆盖安装到同包名的手机上时同样要 +1，否则 `adb install -r` 会报 `INSTALL_FAILED_VERSION_DOWNGRADE`；
4. `version` 按需改，与 `versionCode` 无关。

dev / staging / production 是三个不同包名，各自独立计数，互不影响。

---

## 5. 常见签名与构建报错

| 报错 | 原因与处理 |
|---|---|
| `android-release: no release keystore at …` | 还没有密钥：跑 `pnpm android:mobile:keystore`，或设 `MULTICA_ANDROID_KEYSTORE_PROPERTIES` 指向团队密钥 |
| `Keystore file not found for signing config 'release'` | 属性文件里的 `storeFile` 指向了不存在的密钥库（路径写错或文件被移走） |
| `Failed to read key <alias> from store …` / `keytool error: java.io.IOException: keystore password was incorrect` | 口令与密钥库不匹配，或属性文件被改过；用 `grep storePassword` 对照 |
| `Keystore was tampered with, or password was incorrect` | 同上；也可能是密钥库被截断（拷贝不完整，注意二进制传输） |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` / `signatures do not match previously installed version` | 手机上已装的同包名应用是**另一套密钥**签的：先卸载再装（会清数据），或改用那套密钥构建 |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | 新包 `versionCode` 不大于已装版本：把 `android.versionCode` +1 重新构建 |
| `App not installed` / 「应用未安装」，无更多信息 | 常见于签名不符或包解析失败：`adb install` 会给出具体原因，改用 adb 看 |
| prebuild 打印 `with-android-release-signing: no keystore properties at …` | 没有密钥，release 会退回 **debug 签名**：产物只能自用、不能分发，换台机器重装会签名冲突 |
| `JAVA_HOME points at JDK … not 21` / `JvmVendorSpec … IBM_SEMERU` | JDK 版本不对，见 [README > 首次构建前置](../README.md#首次构建前置) |
| `SDK location not found` | 未设 `ANDROID_HOME` |
| 校验产物签名（可选） | `"$ANDROID_HOME"/build-tools/36.0.0/apksigner verify --print-certs dist/android/<apk>`，输出的证书主题应为 `CN=Multica Android Release …` |

---

## 6. 从零复现（验收清单）

干净 checkout 上按顺序执行，每步都应成功：

```bash
pnpm install
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"      # 或 brew openjdk@21 的实际路径
export ANDROID_HOME="$HOME/Library/Android/sdk"

pnpm android:mobile:keystore        # 1) 仓外生成签名密钥
pnpm android:mobile:dist:prod       # 2) 产出 production 的签名 Release APK
pnpm android:mobile:dist:prod:aab   # 3) 产出 production 的 AAB

git check-ignore -v apps/mobile/dist/android/        # 产物目录被忽略
git check-ignore -v ./keystore.properties            # 签名材料规则生效（任意路径）
APP_ENV=staging pnpm -C apps/mobile exec expo config --type public --json | grep -o '"package": *"[^"]*"'
```

首次构建要编译四套 ABI 的原生模块（含 reanimated / worklets 的 CMake）。本机实测（M1 Max，10 核）：
冷构建 `assembleRelease` **7 分 11 秒**（Gradle `BUILD SUCCESSFUL in 7m 11s`，1074 个 task 全部执行），
紧随其后的 `bundleRelease` 复用缓存只要 **29 秒**（66 executed / 922 up-to-date）。
产物大小：production APK **106 MB**（四套 ABI）、AAB **72 MB**。

---

## 7. 评估：EAS Build 与 CI 自动构建（结论与成本，本轮不接入）

| 方案 | 结论 | 成本 |
|---|---|---|
| 保持现状（本地 `dist:*`） | 已满足「非开发人员也能装上」 | 0；代价是每台构建机都要装 JDK 21 + Android SDK，构建机上的 `~/.multica-android` 或团队密钥要各自就位 |
| **GitHub Actions** | 推荐先接这个。Android 构建不需要 macOS，`ubuntu-latest` 就够；一个 job 里 `pnpm install` → keystore → `android:mobile:dist` → 上传 artifact，跟本机跑的是同一条命令，不需要新配置文件（`eas.json` 之类） | 本仓库是 **public** 仓库，标准 runner 免费；若转私有，Free 档含 2000 分钟/月的 Linux 额度，一次 Release 构建约 10–25 分钟，够每月几十次 |
| EAS Build | 不推荐现在接。它要 Expo 账号、`eas.json` 与一份交给 Expo 托管的签名材料（`eas credentials`），且把构建搬到 Expo 云上 —— 与本项目「密钥留在自己手里、命令留在仓库里」的做法冲突；换来的主要好处（iOS 免本机 Xcode）在 Android 上并不存在。真要接，Android 侧也只是把 `pnpm android:mobile:dist` 交给它跑 | Free 档 15 次 Android 构建/月、低优先级队列；Starter $19/月含 $45 build credit，Android medium worker $1/次 |

两条都没有「必须先做」的理由，等真的需要「别人点一下就有包」时再接 GitHub Actions。
