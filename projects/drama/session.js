export const name = 'drama-session'
export const inject = ['drama', 'tools']

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(ctx.drama), 'drama: create project tool')
}
