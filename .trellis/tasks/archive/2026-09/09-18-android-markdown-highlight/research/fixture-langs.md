# Markdown 内存夹具：12 语言代码块

用于 FEATURE-550 的 pattern cache 占用与释放实测：把 `lib/markdown/shiki.ts` 预注册的
12 种语言各渲染一次，让每种语法的 Oniguruma scanner 都建起来，再测前后台切换的内存。

## TypeScript

```ts
export interface MarkdownSegment {
  type: "prose" | "code" | "image";
  content: string;
  lang?: string;
}

export async function highlightAll(
  segments: MarkdownSegment[],
  theme: string,
): Promise<Map<number, string[][]>> {
  const out = new Map<number, string[][]>();
  for (const [index, segment] of segments.entries()) {
    if (segment.type !== "code" || !segment.lang) continue;
    const tokens = await highlight(segment.content, segment.lang, theme);
    if (!tokens) continue;
    out.set(index, tokens.map((line) => line.map((token) => token.content)));
  }
  return out;
}
```

## JavaScript

```js
const { createHash } = require("node:crypto");

function cacheKey(input, variant) {
  const hash = createHash("sha256").update(String(input)).digest("hex");
  return `${variant ?? "default"}:${hash.slice(0, 16)}`;
}

module.exports = { cacheKey };
```

## TSX

```tsx
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const lines = useMemo(() => code.split("\n"), [code]);
  return (
    <View className="rounded-lg border border-border px-3 py-2">
      <Text className="mb-1 text-xs">{lang}</Text>
      <Pressable onPress={() => copy(code)}>
        {lines.map((line, index) => (
          <Text key={index} className="font-mono text-[13px]">
            {line}
          </Text>
        ))}
      </Pressable>
    </View>
  );
}
```

## JSX

```jsx
export default function App({ children }) {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
```

## Python

```python
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class Token:
    content: str
    color: str | None = None


def group_by_line(tokens: Iterable[Token], width: int = 80) -> list[list[Token]]:
    lines: list[list[Token]] = [[]]
    for token in tokens:
        if len("".join(t.content for t in lines[-1])) + len(token.content) > width:
            lines.append([])
        lines[-1].append(token)
    return [line for line in lines if line]
```

## Go

```go
package markdown

import (
	"strings"
	"unicode/utf8"
)

type Segment struct {
	Type    string
	Content string
	Lang    string
}

func Split(content string) []Segment {
	var out []Segment
	for _, chunk := range strings.Split(content, "\n\n") {
		if !utf8.ValidString(chunk) {
			continue
		}
		out = append(out, Segment{Type: "prose", Content: chunk})
	}
	return out
}
```

## Rust

```rust
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Segment {
    pub kind: String,
    pub content: String,
}

impl Segment {
    pub fn is_code(&self) -> bool {
        self.kind == "code"
    }
}

pub fn index(segments: &[Segment]) -> HashMap<String, usize> {
    segments
        .iter()
        .enumerate()
        .filter(|(_, s)| s.is_code())
        .map(|(i, s)| (s.content.clone(), i))
        .collect()
}
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail

export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"

for variant in debug release; do
  ./gradlew --no-daemon ":app:assemble${variant^}"
done
```

## JSON

```json
{
  "name": "multica-mobile",
  "version": "0.1.0",
  "expo": { "sdkVersion": "55.0.0", "newArchEnabled": true },
  "dependencies": {
    "@shikijs/core": "3.23.0",
    "react-native-enriched-markdown": "0.6.0",
    "react-native-shiki-engine": "0.3.10"
  }
}
```

## YAML

```yaml
name: mobile-android
on:
  push:
    paths: ["apps/mobile/**"]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: corepack pnpm -C apps/mobile test
        env:
          APP_ENV: development
```

## SQL

```sql
select i.id, i.title, count(c.id) as comments
from issue i
left join comment c on c.issue_id = i.id
where i.workspace_id = $1 and i.status <> 'cancelled'
group by i.id, i.title
having count(c.id) > 0
order by comments desc
limit 20;
```

## Markdown

```markdown
## 标题

- 列表项一
- 列表项二

| 列 A | 列 B |
| --- | --- |
| a1 | b1 |

> 引用文本
```

## 结尾

12 个代码块渲染完毕后，12 种语法的 scanner 都已建立。
