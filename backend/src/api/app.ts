import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { AuthError, type AuthService } from '../services/authService.js';
import { DomainError, StateError, TournamentService } from '../services/tournamentService.js';

const titleEnum = z.enum(['GM', 'IM', 'WGM', 'FM', 'WIM', 'CM', 'WFM', 'WCM', 'NONE']);
const statusEnum = z.enum(['ACTIVE', 'WITHDRAWN', 'LATE_ENTRY', 'PAUSED']);
const resultEnum = z.enum([
  'PENDING',
  'WHITE_WIN',
  'BLACK_WIN',
  'DRAW',
  'WHITE_WIN_FORFEIT',
  'BLACK_WIN_FORFEIT',
  'DOUBLE_FORFEIT',
  'FULL_POINT_BYE',
  'HALF_POINT_BYE',
  'ZERO_POINT_BYE',
]);

const createTournamentSchema = z.object({
  name: z.string().min(1),
  numberOfRounds: z.number().int().min(1).max(40),
  date: z.coerce.date().optional(),
  tieBreaks: z.array(z.string()).optional(),
  lateEntryPoints: z.number().min(0).max(1).optional(),
});

/** Administrative data for the FIDE rating report. All optional. */
const adminSchema = z.object({
  city: z.string().max(60).nullable().optional(),
  federation: z.string().max(3).nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  tournamentType: z.string().max(80).nullable().optional(),
  chiefArbiter: z.string().max(80).nullable().optional(),
  deputyArbiters: z.string().max(200).nullable().optional(),
  timeControl: z.string().max(80).nullable().optional(),
});

const updateTournamentSchema = createTournamentSchema.partial().merge(adminSchema);

const playerSchema = z.object({
  fullName: z.string().min(1),
  sex: z.enum(['M', 'F']),
  fideTitle: titleEnum.optional(),
  federation: z.string().max(3).nullable().optional(),
  pairingRating: z.number().int().min(0).max(4000).optional(),
  officialRating: z.number().int().min(0).max(4000).nullable().optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  fideId: z.string().nullable().optional(),
  status: statusEnum.optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Wrap async handlers so rejections reach the error middleware. */
function h(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function createApp(service: TournamentService, auth: AuthService): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const r = express.Router();

  r.get('/health', (_req, res) => res.json({ ok: true }));

  // ── Auth ────────────────────────────────────────────────────────────────

  r.post(
    '/auth/register',
    h(async (req, res) => {
      const { email, name, password } = registerSchema.parse(req.body);
      res.status(201).json(await auth.register(email, name, password));
    }),
  );

  r.post(
    '/auth/login',
    h(async (req, res) => {
      const { email, password } = loginSchema.parse(req.body);
      res.json(await auth.login(email, password));
    }),
  );

  r.get(
    '/auth/me',
    requireAuth,
    h(async (req, res) => res.json(await auth.me(req.userId!))),
  );

  // ── Public read-only (spectators/players need no account) ────────────────

  r.get(
    '/tournaments/:id',
    h(async (req, res) => res.json(await service.getTournament(req.params.id!))),
  );

  r.get(
    '/tournaments/:id/standings',
    h(async (req, res) => res.json(await service.getStandings(req.params.id!))),
  );

  r.get(
    '/tournaments/:id/matrix',
    h(async (req, res) => res.json(await service.getMatrix(req.params.id!))),
  );

  r.get(
    '/tournaments/:id/trf',
    h(async (req, res) => {
      const trf = await service.exportTrf(req.params.id!);
      // Offered as a download so the arbiter gets a file to submit, not a page.
      res
        .type('text/plain')
        .set('Content-Disposition', `attachment; filename="tournament-${req.params.id}.trf"`)
        .send(trf);
    }),
  );

  r.get(
    '/tournaments/:id/report-readiness',
    h(async (req, res) => res.json(await service.reportReadiness(req.params.id!))),
  );

  // ── Arbiter-only ────────────────────────────────────────────────────────
  // Everything below requires a session; routes carrying :id additionally
  // verify ownership via assertOwner (which 404s for a non-owner).

  r.use(requireAuth);

  /** Guard every mutating :id route in one place — no route can forget it. */
  r.use('/tournaments/:id', (req, _res, next) => {
    service
      .assertOwner(req.params.id!, req.userId!)
      .then(() => next())
      .catch(next);
  });

  r.post(
    '/tournaments',
    h(async (req, res) => {
      const input = createTournamentSchema.parse(req.body);
      res.status(201).json(await service.createTournament({ ...input, ownerId: req.userId! }));
    }),
  );

  r.get(
    '/tournaments',
    h(async (req, res) => res.json(await service.listTournaments(req.userId!))),
  );

  r.patch(
    '/tournaments/:id',
    h(async (req, res) => {
      const patch = updateTournamentSchema.parse(req.body);
      res.json(await service.updateTournament(req.params.id!, patch));
    }),
  );

  r.delete(
    '/tournaments/:id',
    h(async (req, res) => {
      await service.deleteTournament(req.params.id!);
      res.status(204).end();
    }),
  );

  r.post(
    '/tournaments/:id/start',
    h(async (req, res) => res.json(await service.startTournament(req.params.id!))),
  );

  r.post(
    '/tournaments/:id/players',
    h(async (req, res) => {
      const input = playerSchema.parse(req.body);
      res.status(201).json(await service.addPlayer(req.params.id!, input));
    }),
  );

  r.patch(
    '/tournaments/:id/players/:playerId',
    h(async (req, res) => {
      const patch = playerSchema.partial().parse(req.body);
      res.json(await service.updatePlayer(req.params.id!, req.params.playerId!, patch));
    }),
  );

  r.delete(
    '/tournaments/:id/players/:playerId',
    h(async (req, res) => {
      await service.removePlayer(req.params.id!, req.params.playerId!);
      res.status(204).end();
    }),
  );

  r.post(
    '/tournaments/:id/rounds',
    h(async (req, res) => res.status(201).json(await service.generateNextRound(req.params.id!))),
  );

  r.delete(
    '/tournaments/:id/rounds/latest',
    h(async (req, res) => res.json(await service.deleteLatestRound(req.params.id!))),
  );

  r.post(
    '/tournaments/:id/pairings/:pairingId/result',
    h(async (req, res) => {
      const { result } = z.object({ result: resultEnum }).parse(req.body);
      res.json(await service.enterResult(req.params.id!, req.params.pairingId!, result));
    }),
  );

  r.put(
    '/tournaments/:id/rounds/:roundId/pairings',
    h(async (req, res) => {
      const { pairings, acknowledgeWarnings } = z
        .object({
          pairings: z
            .array(
              z.object({
                whiteId: z.string(),
                blackId: z.string().nullable(),
                result: resultEnum.optional(),
              }),
            )
            .min(1),
          acknowledgeWarnings: z.boolean().optional(),
        })
        .parse(req.body);
      const result = await service.setRoundPairings(
        req.params.id!,
        req.params.roundId!,
        pairings,
        { acknowledgeWarnings: acknowledgeWarnings ?? false },
      );
      // Warnings that were not acknowledged: nothing was written.
      res.status(result.applied ? 200 : 409).json(result);
    }),
  );

  r.post(
    '/tournaments/:id/validate-pairing',
    h(async (req, res) => {
      const { whiteId, blackId } = z
        .object({ whiteId: z.string(), blackId: z.string().nullable() })
        .parse(req.body);
      res.json(await service.validatePairing(req.params.id!, whiteId, blackId));
    }),
  );

  r.get(
    '/tournaments/:id/check',
    h(async (req, res) => res.json(await service.checkTournament(req.params.id!))),
  );

  app.use('/api', r);

  // Error middleware: map domain/validation errors to HTTP responses.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'ValidationError', issues: err.issues });
    }
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof DomainError) {
      return res.status(err.status).json({ error: err.message, alerts: err.alerts });
    }
    if (err instanceof StateError) {
      return res.status(409).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
