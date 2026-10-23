jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  },
}));

jest.mock('../config', () => ({ API_URL: 'http://localhost:5000' }));

import { render, screen } from '@testing-library/react';
import Login from './Login';

describe('Login', () => {
  test('exibe título e campos do formulário', () => {
    render(<Login onLogin={jest.fn()} />);

    expect(screen.getByRole('heading', { name: /controle financeiro/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/usuário/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument();
  });
});
