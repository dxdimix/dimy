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
