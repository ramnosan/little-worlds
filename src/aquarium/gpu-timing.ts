/** Development-only asynchronous GPU measurements. Never waits for GPU completion. */
export class AquariumGpuTiming {
  private extension;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  totalMs = 0;
  samples = 0;
  constructor(private gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  begin() {
    if (!this.extension) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.extension.GPU_DISJOINT_EXT);
    if (disjoint) {
      for (const query of this.pending) gl.deleteQuery(query);
      this.pending = [];
      return;
    }
    while (
      this.pending.length &&
      gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)
    ) {
      const query = this.pending.shift()!;
      if (!disjoint) {
        this.totalMs += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        this.samples++;
      }
      gl.deleteQuery(query);
    }
    if (this.pending.length >= 4) return;
    this.active = gl.createQuery();
    gl.beginQuery(this.extension.TIME_ELAPSED_EXT, this.active!);
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.extension!.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
  snapshot() {
    return { supported: !!this.extension, samples: this.samples, totalMs: this.totalMs };
  }
  dispose() {
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending = [];
  }
}
