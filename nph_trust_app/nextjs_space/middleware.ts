import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: { signIn: '/login' },
});

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/projects/:path*',
    '/episodes/:path*',
    '/provenance/:path*',
    '/import/:path*',
    '/users/:path*',
    '/approvals/:path*',
    '/settings/:path*',
  ],
};
