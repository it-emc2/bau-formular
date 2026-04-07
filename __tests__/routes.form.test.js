jest.mock('../models/Abnahme', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
}));

const Abnahme = require('../models/Abnahme');
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
  it('returns health status', async () => {
    const handlers = findRouteHandlers('/health', 'get');
    const res = await runHandlers(handlers, {});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('creates a new draft with a generated share token and share link', async () => {
    const handlers = findRouteHandlers('/save', 'post');
    const req = { body: { formData: JSON.stringify({ terminId: 'UT-1000', status: 'submitted' }) } };

    Abnahme.create.mockImplementation(async payload => ({ _id: 'form-1', ...payload }));

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(201);
    expect(Abnahme.create).toHaveBeenCalledWith(
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

    Abnahme.findById.mockResolvedValue(existing);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(200);
    expect(Abnahme.findById).toHaveBeenCalledWith('existing-id');
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

    Abnahme.findById.mockResolvedValue(null);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Formular nicht gefunden' });
  });

  it('loads a form by share token', async () => {
    const handlers = findRouteHandlers('/token/:token', 'get');
    const req = { params: { token: 'abc123' } };

    Abnahme.findOne.mockResolvedValue({ _id: 'form-1', shareToken: 'abc123' });

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(200);
    expect(Abnahme.findOne).toHaveBeenCalledWith({ shareToken: 'abc123' });
    expect(res.body).toEqual({
      success: true,
      data: { _id: 'form-1', shareToken: 'abc123' },
    });
  });

  it('returns 404 when a form token does not exist', async () => {
    const handlers = findRouteHandlers('/token/:token', 'get');
    const req = { params: { token: 'missing-token' } };

    Abnahme.findOne.mockResolvedValue(null);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Formular nicht gefunden' });
  });

  it('submits a form and forces submitted status', async () => {
    const handlers = findRouteHandlers('/submit', 'post');
    const save = jest.fn().mockResolvedValue();
    const existing = { _id: 'form-1', shareToken: 'abc123', status: 'draft', save };
    const req = { body: { formData: JSON.stringify({ _id: 'form-1', terminId: 'UT-1000', status: 'draft' }) } };

    Abnahme.findById.mockResolvedValue(existing);

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(200);
    expect(existing.status).toBe('submitted');
    expect(existing.terminId).toBe('UT-1000');
    expect(save).toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        id: 'form-1',
        shareToken: 'abc123',
      })
    );
  });

  it('returns 400 when form id is missing on submit', async () => {
    const handlers = findRouteHandlers('/submit', 'post');
    const req = { body: { formData: JSON.stringify({ terminId: 'UT-1000' }) } };

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Formular-ID fehlt' });
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

    Abnahme.create.mockRejectedValue(new Error('terminId is required'));

    const res = await runHandlers(handlers, req);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'terminId is required' });
  });
});
