const path = require('path');

const mongoose = require('mongoose');
const serverModule = require('../server');

function getRouteLayer(app, routePath, method) {
  return app._router.stack.find(
    layer => layer.route && layer.route.path === routePath && layer.route.methods[method]
  );
}

describe('server module', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exports the express app and a startServer function', () => {
    expect(serverModule.app).toBeDefined();
    expect(typeof serverModule.startServer).toBe('function');
  });

  it('registers the SPA routes', () => {
    const rootLayer = getRouteLayer(serverModule.app, '/', 'get');
    const homeLayer = getRouteLayer(serverModule.app, '/home', 'get');
    const baustellenLayer = getRouteLayer(serverModule.app, '/AbschlussderBaustelle', 'get');
    const zusaetzlicheLayer = getRouteLayer(serverModule.app, '/BeauftragungzusatzlicheLeistungen', 'get');
    const nachbesserungLayer = getRouteLayer(serverModule.app, '/Nachbesserung', 'get');
    const schadensmeldungLayer = getRouteLayer(serverModule.app, '/Schadensmeldung', 'get');
    const shareLayer = getRouteLayer(serverModule.app, '/form/:token', 'get');

    expect(rootLayer).toBeDefined();
    expect(homeLayer).toBeDefined();
    expect(baustellenLayer).toBeDefined();
    expect(zusaetzlicheLayer).toBeDefined();
    expect(nachbesserungLayer).toBeDefined();
    expect(schadensmeldungLayer).toBeDefined();
    expect(shareLayer).toBeDefined();
  });

  it('root route serves public/index.html', () => {
    const rootLayer = getRouteLayer(serverModule.app, '/', 'get');
    const handler = rootLayer.route.stack[0].handle;
    const res = { sendFile: jest.fn() };

    handler({}, res);

    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'index.html')
    );
  });

  it('share route serves public/index.html', () => {
    const shareLayer = getRouteLayer(serverModule.app, '/form/:token', 'get');
    const handler = shareLayer.route.stack[0].handle;
    const res = { sendFile: jest.fn() };

    handler({ params: { token: 'abc123' } }, res);

    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'index.html')
    );
  });

  it('home route serves public/index.html', () => {
    const homeLayer = getRouteLayer(serverModule.app, '/home', 'get');
    const handler = homeLayer.route.stack[0].handle;
    const res = { sendFile: jest.fn() };

    handler({}, res);

    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'index.html')
    );
  });

  it('baustellenabnahme route serves public/index.html', () => {
    const layer = getRouteLayer(serverModule.app, '/AbschlussderBaustelle', 'get');
    const handler = layer.route.stack[0].handle;
    const res = { sendFile: jest.fn() };

    handler({}, res);

    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'index.html')
    );
  });

  it('zusaetzliche leistungen route serves public/index.html', () => {
    const layer = getRouteLayer(serverModule.app, '/BeauftragungzusatzlicheLeistungen', 'get');
    const handler = layer.route.stack[0].handle;
    const res = { sendFile: jest.fn() };

    handler({}, res);

    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'index.html')
    );
  });

  it('nachbesserung route serves public/index.html', () => {
    const layer = getRouteLayer(serverModule.app, '/Nachbesserung', 'get');
    const handler = layer.route.stack[0].handle;
    const res = { sendFile: jest.fn() };

    handler({}, res);

    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'index.html')
    );
  });

  it('schadensmeldung route serves public/index.html', () => {
    const layer = getRouteLayer(serverModule.app, '/Schadensmeldung', 'get');
    const handler = layer.route.stack[0].handle;
    const res = { sendFile: jest.fn() };

    handler({}, res);

    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'index.html')
    );
  });

  it('mounts the form router on /api/form', () => {
    const apiLayer = serverModule.app._router.stack.find(
      layer => layer.name === 'router' && layer.regexp.test('/api/form')
    );

    expect(apiLayer).toBeDefined();
  });

  it('mounts the bitrix router on /api/bitrix', () => {
    const apiLayer = serverModule.app._router.stack.find(
      layer => layer.name === 'router' && layer.regexp.test('/api/bitrix')
    );

    expect(apiLayer).toBeDefined();
  });

  it('mounts helmet and cors middleware', () => {
    const middlewareNames = serverModule.app._router.stack.map(layer => layer.name);

    expect(middlewareNames).toContain('helmetMiddleware');
    expect(middlewareNames).toContain('corsMiddleware');
  });

  it('allows the angebotskonfigurator fly origin via cors', async () => {
    await expect(new Promise((resolve, reject) => {
      serverModule.corsOrigin('https://angebotskonfigurator-emc2-v2.fly.dev', err => {
        if (err) reject(err);
        else resolve();
      });
    })).resolves.toBeUndefined();
  });

  it('allows the bau-formular fly origin via cors', async () => {
    await expect(new Promise((resolve, reject) => {
      serverModule.corsOrigin('https://bau-formular.fly.dev', err => {
        if (err) reject(err);
        else resolve();
      });
    })).resolves.toBeUndefined();
  });

  it('connects to mongoose and starts listening when startServer is called', async () => {
    const listen = jest.fn((port, callback) => {
      callback();
      return { close: jest.fn() };
    });
    const connectSpy = jest.spyOn(mongoose, 'connect').mockResolvedValue();
    const listenSpy = jest.spyOn(serverModule.app, 'listen').mockImplementation(listen);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const server = await serverModule.startServer();

    expect(connectSpy).toHaveBeenCalled();
    expect(listenSpy).toHaveBeenCalledWith(expect.anything(), expect.any(Function));
    expect(server).toEqual(expect.objectContaining({ close: expect.any(Function) }));
    expect(logSpy).toHaveBeenCalled();
  });
});
