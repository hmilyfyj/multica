# 设计：release 签名的注入方式

## 约束

1. `android/` 是 prebuild 生成物（.gitignore 内），**不能手改**：每次 `expo prebuild -p android` 都会重写。
2. `expo-build-properties` 不支持 signingConfig（只覆盖 SDK 版本、packaging 等），所以签名配置只能自己注入。
3. `expo prebuild` 是**变体无关**的：debug / release 用同一次 prebuild 产物，plugin 在 prebuild 阶段
   无法知道后面要构建哪个变体。
4. 密钥与口令不进仓库。

## 决策

### D1：用 config plugin 在 prebuild 末尾追加 gradle 配置，而不是字符串手术

`plugins/with-android-release-signing.js` 用 `withAppBuildGradle` 在生成文件**末尾追加**：

```groovy
android {
    signingConfigs { release { … } }
    buildTypes { release { signingConfig … } }
}
```

理由：Gradle 的 `android { }` 扩展可以重复打开、后写覆盖先写，所以「追加」不依赖模板里的
任何文本锚点。中间插入（找 `signingConfigs {` / `buildTypes { release {` 再替换）一旦 Expo 升级改模板
就静默失配——而失配的表现是「release 又用 debug 密钥签名」，属于最难发现的一类问题。

### D2：无密钥时降级为 debug 签名，只告警不抛错

plugin 在 `app.config.ts` 的 plugins 里注册，**每次 prebuild（含 debug）都会跑**。若密钥缺失时抛错，
`pnpm android:mobile:device:staging`（README 的既有 debug 流程）会被连带打断。

所以：**plugin 宽容**（缺密钥 → 追加的 gradle 里 `multicaHasReleaseKeystore=false`，release 退回
模板默认的 debug 签名，prebuild 打一行警告）；**分发脚本严格**（`scripts/android-release.sh` 在
prebuild 之前就检查密钥，缺失直接报出生成命令并退出）。风险控制放在真正会对外分发产物的一侧。

### D3：密钥属性用标准 `keystore.properties`，路径由插件在 prebuild 时定格

密钥材料放在仓库之外，格式沿用 Android 惯例（gradle 侧 `Properties.load` + `file(...)`）：

```
storeFile=/Users/…/.multica-android/multica-release.keystore
storePassword=…
keyAlias=multica-release
keyPassword=…
```

解析顺序：`MULTICA_ANDROID_KEYSTORE_PROPERTIES`（指团队密钥，覆盖默认）→ `~/.multica-android/keystore.properties`。
插件把**解析后的绝对路径**写进追加块，不再往 `android/` 里拷一份属性文件：少一个中间产物，
且「prebuild 时用哪套密钥」与「gradle 构建时用哪套」不可能漂移。口令本身不进 `android/app/build.gradle`，
只进那个仓外的、`chmod 600` 的属性文件。

PKCS12 是 JDK 9+ 的默认 keystore 类型，`keytool` 会把 key password 与 store password 绑定为同一个值，
所以生成的属性文件里两个口令相同（文档说明这一点）。

### D4：产物命名与包名解耦但可核对

产物名 `<slug>-<variant>-<version>-vc<versionCode>.<ext>`，例如
`multica-mobile-production-0.1.0-vc1.apk`。三段全部取自 `expo config --type public --json`
（与 prebuild 写入 gradle 的是同一份配置），所以**产物名不会和 APK 里的包名/版本漂移**；
脚本 summary 里同时打印包名，便于确认变体。

变体标签取 `APP_ENV`（未设置视为 `dev`），与 `app.config.ts` 的三分支一一对应：
`dev` → `…mall.dev` / `staging` → `…mall.staging` / `production` → `…mall`。

### D5：versionCode 保持字面量

`app.config.ts` 里 `versionCode: 1` 是刻意不派生自 `version` 的（注释已说明），本任务只补文档：
每次要让新包能覆盖安装/上传，就手工 +1；不能重复上传同一包名的同一 versionCode。

## 风险与验证

| 风险 | 验证 |
|---|---|
| 追加块被 prebuild 重写后重复累积 | 连续两次 prebuild，断言追加标记只出现一次 |
| 模板升级导致追加块语义失效 | `assembleRelease` 真构建 + `apksigner verify --print-certs` 断言签发者 |
| 缺密钥时静默用 debug 密钥 | 分发脚本前置检查；plugin 告警行；文档写明 |
| 产物名与实际包名漂移 | 脚本从 `expo config` 取名并打印包名 |
