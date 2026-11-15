import { describe, expect, it } from "vitest";
import { pathHas } from "../agent/lib/winpath.mjs";

describe("PATH に入っているか", () => {
  it("大文字・小文字、最後の \\、%〇〇% の違いを見ない", () => {
    const expand = (s: string) => s.replace("%USERPROFILE%", "C:\\Users\\sike1");
    expect(pathHas("C:\\Windows;%USERPROFILE%\\.local\\bin\\", "C:\\Users\\sike1\\.local\\bin", expand)).toBe(true);
    expect(pathHas("C:\\windows;C:\\USERS\\SIKE1\\.LOCAL\\BIN", "C:\\Users\\sike1\\.local\\bin")).toBe(true);
    expect(pathHas("C:\\Windows;C:\\Users\\sike1\\AppData\\Local\\Microsoft\\WindowsApps", "C:\\Users\\sike1\\.local\\bin")).toBe(false);
  });
});
