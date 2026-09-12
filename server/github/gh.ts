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
