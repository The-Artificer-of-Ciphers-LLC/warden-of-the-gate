// Ground-truth tags: "// expect:<family>:<role>" mark every line that semantically binds to that symbol family.
export type ItemId = string;

export interface Entry { // expect:Entry:def
  id: ItemId;
  actor: string;
  at: number;
}
