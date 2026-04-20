import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' },
    });
    return;
  }

  // Check GDPR consent for EU users
  if (!req.session.gdprConsented) {
    res.status(403).json({
      error: {
        code: 'GDPR_CONSENT_REQUIRED',
        message: 'GDPR consent is required to use this service.',
      },
    });
    return;
  }

  next();
}

export function requireGdprConsent(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.gdprConsented) {
    res.status(403).json({
      error: { code: 'GDPR_CONSENT_REQUIRED', message: 'Please accept our privacy policy.' },
    });
    return;
  }
  next();
}
