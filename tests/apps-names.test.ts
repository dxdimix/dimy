import { describe, expect, it } from "vitest";
import { APPS, detectOpenCommand } from "../src/lib/apps";
import { toSpeech } from "../src/lib/wake";

describe("アプリのシステム名", () => {
  it("一覧はシステム名で出す", () => {
    const name = (id: string) => APPS.find((a) => a.id === id)?.name;
    expect([name("fx"), name("kabu"), name("keiba")]).toEqual(["DimiX", "かぶ太郎", "競馬Edge"]);
  });
  it("昔の呼び方でも開ける", () => {
    expect(detectOpenCommand("株を開いて")?.name).toBe("かぶ太郎");
    expect(detectOpenCommand("FX開いて")?.name).toBe("DimiX");
    expect(detectOpenCommand("競馬を開いて")?.name).toBe("競馬Edge");
  });
  it("読み上げ", () => {
    expect(toSpeech("DimiXを開きます")).toBe("ディミックスを開きます");
    expect(toSpeech("競馬Edgeを開きます")).toBe("けいばエッジを開きます");
  });
});

describe("開く命令と、調べてほしい頼みの見分け", () => {
  it("中身を調べる頼みは開かない", () => {
    expect(detectOpenCommand("今日の株価が情報を教えてください 買い時のものが ピックアップされていたが かぶたろうね システムから引っ張ってきて 一覧で見せてください")).toBeNull();
    expect(detectOpenCommand("かぶ太郎を開いて")?.id).toBe("kabu");
  });
  it("出典は読み上げない", () => {
    expect(toSpeech("おすすめは nikko 倉敷店です。\n\nSources:\n- [セントラル（Yahoo!マップ）](https://map.yahoo.co.jp/x)")).toBe("おすすめは nikko 倉敷店です。");
    expect(toSpeech("詳しくは[こちら](https://e.com)を見てください")).toBe("詳しくはこちらを見てください");
  });
});
