// gh CLI를 자식 프로세스로 부른다. 인증은 gh가 갖고 있다. 읽기는 --json뿐이다.

export type GhIssue = {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  labels: { name: string }[];
  updatedAt: string;
  closedAt: string | null;
};

/** 이슈 원천. 테스트는 가짜를 끼운다. */
export type IssueSource = (owner: string, name: string) => Promise<GhIssue[]>;

export const ghListIssues: IssueSource = async (owner, name) => {
  const proc = Bun.spawn(
    [
      "gh", "issue", "list",
      "--repo", `${owner}/${name}`,
      "--state", "all",
      "--limit", "1000",
      "--json", "number,title,body,state,labels,updatedAt,closedAt",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh issue list ${owner}/${name} 실패 (${code}): ${err.trim()}`);
  return JSON.parse(out) as GhIssue[];
};

// ---- 라벨 읽기 · 쓰기. cadence가 GitHub에 쓰는 유일한 것이다. ----

async function run(args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} 실패 (${code}): ${err.trim()}`);
  return out;
}

export type GhLabels = {
  /** 지금 GitHub에 있는 라벨 이름들 */
  read: (owner: string, name: string, number: number) => Promise<string[]>;
  /** 라벨을 더하고 뺀다 */
  write: (owner: string, name: string, number: number, add: string[], remove: string[]) => Promise<void>;
};

export const ghLabels: GhLabels = {
  async read(owner, name, number) {
    const out = await run(["issue", "view", String(number), "--repo", `${owner}/${name}`, "--json", "labels"]);
    return (JSON.parse(out) as { labels: { name: string }[] }).labels.map((l) => l.name);
  },
  async write(owner, name, number, add, remove) {
    const args = ["issue", "edit", String(number), "--repo", `${owner}/${name}`];
    for (const l of add) args.push("--add-label", l);
    for (const l of remove) args.push("--remove-label", l);
    await run(args);
  },
};
