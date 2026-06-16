import { proxyToApiOrigin, type Env } from '../_utils/proxy';

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  return proxyToApiOrigin(request, env);
};
