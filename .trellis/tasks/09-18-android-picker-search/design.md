# 设计：平台感知的选择器搜索栏

## 1. Hook 形态：返回 `{ query, searchBar }`

```tsx
export function usePickerSearchBar(
  placeholder: string,
  options?: { autoFocus?: boolean },
): { query: string; searchBar: ReactNode };
```

- iOS：`searchBar === null`，`query` 仍由 hook 持有；hook 只做原来的
  `navigation.setOptions({ headerSearchBarOptions })`（参数一字不改）。
- Android / 其余平台：`searchBar` 是 `<SearchField …/>` 元素，`query` 由同一个 `useState` 提供。

调用方（7 个路由）形状固定：

```tsx
const { query, searchBar } = usePickerSearchBar("Search people", { autoFocus: true });
return (
  <>
    {searchBar}
    <AssigneePickerBody value={value} query={query} onChange={…} />
  </>
);
```

为什么让 hook 返回元素而不是让路由自己判断平台：

- 7 个路由里不出现 `Platform.OS`（验收项）。差异只有一处。
- iOS 上 `searchBar` 为 `null`，fragment 里只剩 body 一个子节点 —— **FlatList 仍是路由的直接子节点**，
  `RNSScreenContentWrapper` 依旧能把它当作直接 subview（`react-native-screens#3634`：包一层 `<View>` 会让
  iOS 原生搜索与列表错位）。这一步是「iOS 不变」的关键。
- 备选「hook 只返回 query，各路由自己 `{Platform.OS !== "ios" && <SearchField/>}`」会把平台判断散到 7 个文件，
  且每处都要重复传 `value/onChangeText`，直接违反 spec 的「差异集中封装」。

hook 改名 `useNativeSearchBar` → `usePickerSearchBar`（文件同名 `.ts` → `.tsx`）：Android 分支已经不是 native，
名字必须与行为一致；调用方本来就要改接线，改名成本为零。

## 2. 共享搜索框：`components/ui/search-field.tsx`

复用已存在的 `components/ui/text-field.tsx`（RNR 原语，已按 Android 语义处理好 `includeFontPadding` /
`textAlignVertical`），只在外层补「放大镜图标 + 清除按钮 + 分隔线」：

```tsx
<View className="flex-row items-center gap-2 border-b border-border px-4 py-2">
  <Ionicons name="search" … />
  <TextField className="flex-1" autoCapitalize="none" autoCorrect={false} returnKeyType="search" … />
  {value.length > 0 ? <Pressable onPress={() => onChangeText("")}><Ionicons name="close-circle" … /></Pressable> : null}
</View>
```

- 不新增依赖：图标用既有的 `@expo/vector-icons`，输入框用既有 `TextField`。
- 不放 `ListHeaderComponent`：搜索框与 FlatList 同级，回落列表时搜索框不参与滚动 —— 顺带避开项目注释里
  记录过的「ListHeaderComponent 内 TextInput 聚焦丢失」与 `#3634` 两类坑。
- `autoCapitalize="none"` 对齐 iOS `headerSearchBarOptions.autoCapitalize: "none"`。

## 3. 取消 / 清空语义

| | iOS | Android |
|---|---|---|
| 取消 | 原生搜索栏的 Cancel：清空原生文本、**不触发** `onChangeText`；路由在 `onCancelButtonPress` 里重置 query | 无「取消」按钮，清除（✕）按钮 `onChangeText("")` → `setQuery("")` |
| 结果 | `query` 变空 → 列表恢复全量、滚回顶部 | 同左 |

两端最终都是「`query` 回到空字符串 → body 重算行 + `useScrollToTopOnChange` 复位」，契约一致。

## 4. `_layout.tsx` 的导航头取舍（issue 要求写清）

**结论：本轮不动这 7 条 `<Stack.Screen>` 的任何配置。**

- iOS：保持原样。3 条带 `headerShown: true` + `title` 的路由继续用原生导航头 + `UISearchController`；
  另 4 条不加（本轮边界禁止改 iOS 可见行为）。
- Android：`headerShown: true` 实测**完全不渲染**（547 截图：sheet 从顶边就是内容，无标题、无输入框），
  既不显示标题也不占高度 —— 所以「保留导航头显示标题」在 Android 上不成立，也没有必要为它写平台分支；
  标题由各路由的业务语义承载（chip 上已写明「Assignee / Label / Project」，行内容自解释），
  搜索能力则统一由 body 内的 `SearchField` 承担。
- 结果：Android 的 7 个 sheet 顶边就是搜索框（位置与 iOS 原生搜索栏一致），下面接列表。

## 5. 已知遗留（本轮记录，不修）

iOS 上 `issue/[id]/picker/label`、`issue/[id]/picker/project`、`new-issue-picker/project`、
`project/[id]/picker/lead` 这 4 条路由缺 `headerShown: true`，因此**在 iOS 上今天也没有搜索框与标题**
（依据见 prd「Verified Facts」第 3 条）。修法是把这 4 条改成
`{ ...SHEET_OPTIONS, headerShown: true, title: "…" }`（与 assignee 一致），但那是**改 iOS 可见行为**，
与 issue 验收「iOS 行为与改动前一致」冲突，故留给用户决策；Android 侧不受影响（本来就渲染不出来）。

## 6. 回滚

改动集中在 1 个 hook + 1 个组件 + 7 个路由接线。回滚 = 把这 7 个路由换回 `const query = useNativeSearchBar(…)`
并删掉 `SearchField` 与 Android 分支。
