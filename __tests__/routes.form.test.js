jest.mock('../models/Abnahme', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../models/Entwurf', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
}));

const Abnahme = require('../models/Abnahme');
const Entwurf = require('../models/Entwurf');
const router = require('../routes/form');

function findRouteHandlers(routePath, method) {
  const layer = router.stack.find(
    entry => entry.route && entry.route.path === routePath && entry.route.methods[method]
  );

  return layer.route.stack
    .map(stackLayer => stackLayer.handle)
    .filter(handler => handler.name !== 'multerMiddleware');
}

async function runHandlers(handlers, req) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  for (const handler of handlers) {
    if (handler.length >= 3) {
      await new Promise((resolve, reject) => {
        handler(req, res, err => (err ? reject(err) : resolve()));
      });
    } else {
      await handler(req, res);
    }
  }

  return res;
}

describe('form routes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns health status', async () => {
    const handlers = findRouteHandlers('/health', 'get');
    const res = await runHandlers(handlers, {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('lists drafts ordered by latest update', async () => {
    const handlers = findRouteHandlers('/drafts', 'get');
    const draftDocs = [
      {
        _id: 'draft-1',
        shareToken: 'share-1',
        terminId: 'BITRIX-1',
        kundennummer: '1001',
        auftragsNummer: 'A-1',
        vorname: 'Max',
        nachname: 'Muster',
        name: 'Max Muster',
        status: 'draft',
        updatedAt: '2026-04-07T10:00:00.000Z',
      },
    ];
    const lean = jest.fn().mockResolvedValue(draftDocs);
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });

    Entwurf.find.mockReturnValue({ sort });

    const res = await runHandlers(handlers, { query: {} });

    expect(Entwurf.find).toHaveBeenCalledWith({ status: 'draft' });
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(limit).toHaveBeenCalledWith(20);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, drafts: draftDocs });
  });

  it('filters drafts by search query', async () => {
    const handlers = findRouteHandlers('/drafts', 'get');
    const lean = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });

    Entwurf.find.mockReturnValue({ sort });

    await runHandlers(handlers, { query: { q: 'Cornelia' } });

    expect(Entwurf.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        $or: expect.arrayContaining([
          { vorname: /Cornelia/i },
          { nachname: /Cornelia/i },
          { name: /Cornelia/i },
        ]),
      })
    );
  });

  it('loads a draft by id', async () => {
    const handlers = findRouteHandlers('/drafts/:id', 'get');
    const draft = { _id: 'draft-1', status: 'draft', terminId: 'BITRIX-1' };

    Entwurf.findById.mockResolvedValue(draft);

    const res = await runHandlers(handlers, { params: { id: 'draft-1' } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: draft });
  });

  it('returns 404 when a draft cannot be loaded by id', async () => {
    const handlers = findRouteHandlers('/drafts/:id', 'get');

    Entwurf.findById.mockResolvedValue(null);

    const res = await runHandlers(handlers, { params: { id: 'submitted-1' } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Entwurf nicht gefunden' });
  });

  it('creates a new draft with a generated share token and share link', async () => {
    const handlers = findRouteHandlers('/save', 'post');
    const req = { body: { formData: JSON.stringify({ terminId: 'UT-1000', status: 'submitted' }) } };

    Entwurf.create.mockImplementation(async payload => ({ _id: 'form-1', ...payload }));

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(201);
    expect(Entwurf.create).toHaveBeenCalledWith(
      expect.objectContaining({
        terminId: 'UT-1000',
        status: 'draft',
        shareToken: expect.any(String),
      })
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        id: 'form-1',
        shareToken: expect.any(String),
        shareLink: expect.stringMatching(/^\/form\//),
      })
    );
  });

  it('updates an existing draft when an id is provided', async () => {
    const handlers = findRouteHandlers('/save', 'post');
    const save = jest.fn().mockResolvedValue();
    const existing = { _id: 'existing-id', terminId: 'OLD', shareToken: 'share-1', save };
    const req = { body: { formData: JSON.stringify({ _id: 'existing-id', terminId: 'NEW-ID' }) } };

    Entwurf.findById.mockResolvedValue(existing);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(200);
    expect(Entwurf.findById).toHaveBeenCalledWith('existing-id');
    expect(existing.terminId).toBe('NEW-ID');
    expect(save).toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        id: 'existing-id',
        shareToken: 'share-1',
      })
    );
  });

  it('returns 404 when updating a missing draft', async () => {
    const handlers = findRouteHandlers('/save', 'post');
    const req = { body: { formData: JSON.stringify({ _id: 'missing-id', terminId: 'UT-1000' }) } };

    Entwurf.findById.mockResolvedValue(null);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Formular nicht gefunden' });
  });

  it('loads a form by share token', async () => {
    const handlers = findRouteHandlers('/token/:token', 'get');
    const req = { params: { token: 'abc123' } };

    Entwurf.findOne.mockResolvedValue({ _id: 'form-1', shareToken: 'abc123' });
    Abnahme.findOne.mockResolvedValue(null);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(200);
    expect(Entwurf.findOne).toHaveBeenCalledWith({ shareToken: 'abc123' });
    expect(res.body).toEqual({
      success: true,
      data: { _id: 'form-1', shareToken: 'abc123' },
    });
  });

  it('returns 404 when a form token does not exist', async () => {
    const handlers = findRouteHandlers('/token/:token', 'get');
    const req = { params: { token: 'missing-token' } };

    Entwurf.findOne.mockResolvedValue(null);
    Abnahme.findOne.mockResolvedValue(null);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Formular nicht gefunden' });
  });

  it('submits a form and forces submitted status', async () => {
    const handlers = findRouteHandlers('/submit', 'post');
    const deleteOne = jest.fn().mockResolvedValue();
    const existing = {
      _id: 'form-1',
      shareToken: 'abc123',
      status: 'draft',
      terminId: 'OLD',
      toObject: jest.fn().mockReturnValue({ _id: 'form-1', shareToken: 'abc123', status: 'draft', terminId: 'OLD' }),
      deleteOne,
    };
    const req = { body: { formData: JSON.stringify({ _id: 'form-1', terminId: 'UT-1000', status: 'draft' }) } };

    Entwurf.findById.mockResolvedValue(existing);
    Abnahme.create.mockImplementation(async payload => ({ _id: 'submitted-1', ...payload }));

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(200);
    expect(Abnahme.create).toHaveBeenCalledWith(
      expect.objectContaining({
        terminId: 'UT-1000',
        status: 'submitted',
        shareToken: 'abc123',
      })
    );
    expect(deleteOne).toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        id: 'submitted-1',
        shareToken: 'abc123',
      })
    );
  });

  it('creates a submitted form when submit is called without an id', async () => {
    const handlers = findRouteHandlers('/submit', 'post');
    const req = { body: { formData: JSON.stringify({ terminId: 'UT-1000' }) } };

    Abnahme.create.mockImplementation(async payload => ({ _id: 'submitted-1', ...payload }));

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(201);
    expect(Abnahme.create).toHaveBeenCalledWith(
      expect.objectContaining({
        terminId: 'UT-1000',
        status: 'submitted',
        shareToken: expect.any(String),
      })
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        id: 'submitted-1',
        shareToken: expect.any(String),
        shareLink: expect.stringMatching(/^\/form\//),
      })
    );
  });

  it('returns 404 when submitting a missing form', async () => {
    const handlers = findRouteHandlers('/submit', 'post');
    const req = { body: { formData: JSON.stringify({ _id: 'missing-id', terminId: 'UT-1000' }) } };

    Abnahme.findById.mockResolvedValue(null);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Formular nicht gefunden' });
  });

  it('returns 400 when create fails validation', async () => {
    const handlers = findRouteHandlers('/save', 'post');
    const req = { body: { formData: JSON.stringify({}) } };

    Entwurf.create.mockRejectedValue(new Error('terminId is required'));

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'terminId is required' });
  });
});
