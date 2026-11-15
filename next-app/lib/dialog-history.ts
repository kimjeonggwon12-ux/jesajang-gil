// 화면 내용·회원 정보는 history에 넣지 않는다. Next가 보관한 상태는 그대로 유지한다.
export const DIALOG_HISTORY_KEY = '__teacherSquareDialog';
type State = Record<string, unknown>;
export type DialogAddress = {base: string; open: string};
type Layer = {key: string; close: () => void; busy: () => boolean; address?: () => DialogAddress | undefined};
type Port = {
  state: () => unknown;
  url: () => string;
  push: (state: State, url?: string) => void;
  replace: (state: State, url?: string) => void;
  go: (delta: number) => void;
};
const object = (value: unknown): State => value && typeof value === 'object' ? value as State : {};

export class DialogHistory {
  private layers = new Map<string, Layer>();
  private applied: Layer[] = [];
  private url = '';
  private openUrl = '';
  private adoptedOwner = '';
  private scheduled = false;
  private travelling = false;
  private previous: State = {};
  private port: Port;
  private owner: string;
  constructor(port: Port, owner: string) {this.port = port; this.owner = owner;}

  private depth(state = this.port.state()): number | null {
    const marker = object(object(state)[DIALOG_HISTORY_KEY]);
    return (marker.owner === this.owner || !!this.adoptedOwner && marker.owner === this.adoptedOwner) && Number.isSafeInteger(marker.depth) && Number(marker.depth) >= 0 ? Number(marker.depth) : null;
  }
  private state(depth: number, source = this.port.state()): State {
    return {...object(source), [DIALOG_HISTORY_KEY]: {owner: this.adoptedOwner || this.owner, depth}};
  }
  private samePage() {return this.port.url() === this.url || !!this.openUrl && this.port.url() === this.openUrl;}
  private frameUrl(depth: number) {return depth > 0 && this.openUrl ? this.openUrl : this.url;}
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {this.scheduled = false; this.sync();});
  }
  register(layer: Layer) {
    this.layers.set(layer.key, layer);
    this.schedule();
    return () => {
      if (this.layers.get(layer.key) === layer) this.layers.delete(layer.key);
      this.schedule();
    };
  }
  private sync() {
    if (this.travelling) return;
    const desired = [...this.layers.values()];
    const samePage = this.samePage();
    let depth = samePage ? this.depth() : null;
    // 링크 이동/페이지 교체 뒤의 unmount가 새 경로를 뒤로 돌리지 않는다.
    if (!samePage && !desired.length) {this.applied = []; return;}
    try {
      if (depth === null) {
        if (!desired.length) {this.applied = []; return;}
        const address = desired[0].address?.();
        const previousMarker = object(object(this.port.state())[DIALOG_HISTORY_KEY]);
        this.url = address?.base || this.port.url();
        this.openUrl = address?.open || '';
        // 읽기 상세 한 층의 새로고침: 이미 있는 칸을 이어받고 이전 목록 칸도 인식한다.
        // 주소 없는 입력 양식/사진/연락처 등의 옛 층은 이 방식으로 복원하지 않는다.
        const adopt = !!this.openUrl && this.port.url() === this.openUrl && typeof previousMarker.owner === 'string' && previousMarker.depth === 1;
        this.adoptedOwner = adopt ? String(previousMarker.owner) : '';
        depth = adopt ? 1 : 0;
        this.port.replace(this.state(depth), this.frameUrl(depth));
      } else if (depth === 0 && desired.length) {
        // 닫고 다른 글을 열면 같은 목록을 기반으로 새 주소 한 칸만 만든다.
        const address = desired[0].address?.();
        this.openUrl = address?.open || '';
      }
      const address = desired[0]?.address?.();
      if (depth > 0 && address && address.base === this.url && address.open !== this.openUrl) {
        this.openUrl = address.open;
        this.port.replace(this.state(depth), this.frameUrl(depth));
      }
      this.applied = desired;
      if (desired.length < depth) {
        this.travelling = true;
        this.port.go(desired.length - depth);
        return;
      }
      // 같은 commit의 닫기→다른 양식 열기/StrictMode 재등록은 같은 칸을 쓴다.
      for (let i = depth; i < desired.length; i++) this.port.push(this.state(i + 1), this.frameUrl(i + 1));
      this.previous = object(this.port.state());
    } catch {
      // 기록 API가 차단되어도 닫기/취소와 업무 화면은 계속 사용할 수 있다.
      this.travelling = false;
      this.applied = desired;
    }
  }
  pop(): boolean {
    const samePage = this.samePage();
    const depth = samePage ? this.depth() : null;
    const wasTravelling = this.travelling;
    this.travelling = false;
    if (depth === null) {
      // 실제 다른 경로로 이동한 경우 React의 페이지 수명에 맡긴다.
      this.applied = [];
      return false;
    }
    if (wasTravelling) {this.schedule(); return true;}
    let handled = false;
    if (depth < this.applied.length) {
      handled = true;
      const gone = this.applied.slice(depth);
      if (gone.some(layer => layer.busy())) {
        // popstate 자체는 취소 불가. 같은 화면의 저장 중인 층만 다시 보존한다.
        try {for (let i = depth; i < this.applied.length; i++) this.port.push(this.state(i + 1, this.previous), this.frameUrl(i + 1));} catch {}
        return true;
      }
      this.applied = this.applied.slice(0, depth);
      for (const layer of gone.reverse()) {
        this.layers.delete(layer.key);
        layer.close();
      }
    } else if (depth > this.applied.length) {
      if (this.openUrl && this.port.url() === this.openUrl) {
        // 명시적인 글 주소의 앞으로/새로고침은 인증 조회로 다시 연다. 입력 양식은 복원하지 않는다.
        return true;
      }
      // 앞으로/새로고침에 남은 기록으로 닫힌 개인정보나 입력 양식을 재생하지 않는다.
      try {this.port.replace(this.state(this.applied.length));} catch {}
    }
    this.previous = object(this.port.state());
    return handled;
  }
}
