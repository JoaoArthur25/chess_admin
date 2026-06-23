import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
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

/** Wrap async handlers so rejections reach the error middleware. */
function h(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function createApp(service: TournamentService): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const r = express.Router();

  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.post(
    '/tournaments',
    h(async (req, res) => {
      const input = createTournamentSchema.parse(req.body);
      res.status(201).json(await service.createTournament(input));
    }),
  );

  r.get(
    '/tournaments',
    h(async (_req, res) => res.json(await service.listTournaments())),
  );

  r.get(
    '/tournaments/:id',
    h(async (req, res) => res.json(await service.getTournament(req.params.id!))),
  );

  r.patch(
    '/tournaments/:id',
    h(async (req, res) => {
      const patch = createTournamentSchema.partial().parse(req.body);
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
      res.type('text/plain').send(await service.exportTrf(req.params.id!));
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
