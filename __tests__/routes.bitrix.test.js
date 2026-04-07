describe('bitrix routes', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.BITRIX_WEBHOOK_BASE = 'https://example.bitrix/rest/1/token';
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.BITRIX_WEBHOOK_BASE;
    jest.restoreAllMocks();
  });

  function loadRouter() {
    return require('../routes/bitrix');
  }

  function findRouteHandlers(router, routePath, method) {
    const layer = router.stack.find(
      entry => entry.route && entry.route.path === routePath && entry.route.methods[method]
    );

    return layer.route.stack
      .map(stackLayer => stackLayer.handle)
      .filter(handler => handler.name !== 'jsonParser');
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

  it('loads a contact from Bitrix', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ result: { ID: '42', NAME: 'Max' } }),
    });

    const router = loadRouter();
    const handlers = findRouteHandlers(router, '/contact/:id', 'get');
    const res = await runHandlers(handlers, { params: { id: '42' } });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/crm.contact.get.json?id=42'),
      { method: 'GET' }
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.result.NAME).toBe('Max');
  });

  it('patches missing contact address from requisites', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        json: async () => ({ result: { ID: '42', ADDRESS: '', ADDRESS_CITY: '', ADDRESS_POSTAL_CODE: '' } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ result: [{ ID: '77' }] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ result: [{ ADDRESS_1: 'Musterstrasse 1', POSTAL_CODE: '10115', CITY: 'Berlin' }] }),
      });

    const router = loadRouter();
    const handlers = findRouteHandlers(router, '/contact/:id', 'get');
    const res = await runHandlers(handlers, { params: { id: '42' } });

    expect(res.statusCode).toBe(200);
    expect(res.body.result.ADDRESS).toBe('Musterstrasse 1');
    expect(res.body.result.ADDRESS_POSTAL_CODE).toBe('10115');
    expect(res.body.result.ADDRESS_CITY).toBe('Berlin');
    expect(res.body.__addressSource).toBe('REQUISITE:77');
  });

  it('returns 400 when comment payload is incomplete', async () => {
    const router = loadRouter();
    const handlers = findRouteHandlers(router, '/timeline/comment', 'post');
    const res = await runHandlers(handlers, { body: { entityType: '', entityId: '', comment: '' } });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'entityType is required' });
  });

  it('posts a timeline comment to Bitrix', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ result: 123 }),
    });

    const router = loadRouter();
    const handlers = findRouteHandlers(router, '/timeline/comment', 'post');
    const res = await runHandlers(handlers, {
      body: { entityType: 'deal', entityId: 55, comment: 'Test comment' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/crm.timeline.comment.add.json?'),
      { method: 'GET' }
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ result: 123 });
  });

  it('loads crm items filtered by the default STAGE_ID', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ result: { items: [{ id: 1, title: 'Item 1' }] }, total: 1 }),
    });

    const router = loadRouter();
    const handlers = findRouteHandlers(router, '/items/by-stage', 'get');
    const res = await runHandlers(handlers, {
      query: { entityTypeId: '2' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/crm.item.list.json?'),
      { method: 'GET' }
    );
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('entityTypeId=2');
    expect(calledUrl).toContain('filter%5BSTAGE_ID%5D=C22%3AUC_T5EXSL');
    expect(calledUrl).toContain('useOriginalUfNames=Y');
    expect(res.statusCode).toBe(200);
    expect(res.body.result.items[0].title).toBe('Item 1');
  });

  it('accepts a custom stageId for crm.item.list', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ result: { items: [] }, total: 0 }),
    });

    const router = loadRouter();
    const handlers = findRouteHandlers(router, '/items/by-stage', 'get');
    const res = await runHandlers(handlers, {
      query: { entityTypeId: '2', stageId: 'C22:CUSTOM_STAGE', select: 'id,title,stageId' },
    });

    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('filter%5BSTAGE_ID%5D=C22%3ACUSTOM_STAGE');
    expect(calledUrl).toContain('select%5B%5D=id');
    expect(calledUrl).toContain('select%5B%5D=title');
    expect(calledUrl).toContain('select%5B%5D=stageId');
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when entityTypeId is missing for crm.item.list', async () => {
    const router = loadRouter();
    const handlers = findRouteHandlers(router, '/items/by-stage', 'get');
    const res = await runHandlers(handlers, { query: {} });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'entityTypeId is required and must be a positive integer',
    });
  });
});
