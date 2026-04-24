// Minimal offline Chess.js implementation for web app
(function (global) {
    const PAWN = 'p';
    const KNIGHT = 'n';
    const BISHOP = 'b';
    const ROOK = 'r';
    const QUEEN = 'q';
    const KING = 'k';

    const WHITE = 'w';
    const BLACK = 'b';

    function Chess(fen) {
        this.board_state = [];
        this.turn_color = WHITE;
        this.move_history = [];
        this.game_over = false;
        this.game_result = null;
        this.halfmove_clock = 0;
        this.fullmove_number = 1;
        this.en_passant_target = null;
        this.castling_rights = { wK: true, wQ: true, bK: true, bQ: true };

        this.reset();
        if (fen) {
            try {
                this.load(fen);
            } catch (e) {
                this.reset();
            }
        }
    }

    Chess.prototype.reset = function () {
        this.board_state = [
            [{ type: ROOK, color: BLACK }, { type: KNIGHT, color: BLACK }, { type: BISHOP, color: BLACK }, { type: QUEEN, color: BLACK }, { type: KING, color: BLACK }, { type: BISHOP, color: BLACK }, { type: KNIGHT, color: BLACK }, { type: ROOK, color: BLACK }],
            [{ type: PAWN, color: BLACK }, { type: PAWN, color: BLACK }, { type: PAWN, color: BLACK }, { type: PAWN, color: BLACK }, { type: PAWN, color: BLACK }, { type: PAWN, color: BLACK }, { type: PAWN, color: BLACK }, { type: PAWN, color: BLACK }],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [{ type: PAWN, color: WHITE }, { type: PAWN, color: WHITE }, { type: PAWN, color: WHITE }, { type: PAWN, color: WHITE }, { type: PAWN, color: WHITE }, { type: PAWN, color: WHITE }, { type: PAWN, color: WHITE }, { type: PAWN, color: WHITE }],
            [{ type: ROOK, color: WHITE }, { type: KNIGHT, color: WHITE }, { type: BISHOP, color: WHITE }, { type: QUEEN, color: WHITE }, { type: KING, color: WHITE }, { type: BISHOP, color: WHITE }, { type: KNIGHT, color: WHITE }, { type: ROOK, color: WHITE }],
        ];
        this.turn_color = WHITE;
        this.move_history = [];
        this.game_over = false;
        this.game_result = null;
        this.castling_rights = { wK: true, wQ: true, bK: true, bQ: true };
        this.en_passant_target = null;
        this.halfmove_clock = 0;
        this.fullmove_number = 1;
    };

    Chess.prototype.fen = function () {
        let fen = '';
        for (let rank = 0; rank < 8; rank++) {
            let empty = 0;
            for (let file = 0; file < 8; file++) {
                const piece = this.board_state[rank][file];
                if (!piece) {
                    empty++;
                } else {
                    if (empty > 0) {
                        fen += empty;
                        empty = 0;
                    }
                    const char = piece.type;
                    fen += piece.color === WHITE ? char.toUpperCase() : char;
                }
            }
            if (empty > 0) fen += empty;
            if (rank < 7) fen += '/';
        }
        fen += ' ' + this.turn_color + ' ';
        const castling = (this.castling_rights.wK ? 'K' : '') + (this.castling_rights.wQ ? 'Q' : '') + (this.castling_rights.bK ? 'k' : '') + (this.castling_rights.bQ ? 'q' : '');
        fen += (castling || '-') + ' ';
        fen += (this.en_passant_target || '-') + ' ';
        fen += this.halfmove_clock + ' ' + this.fullmove_number;
        return fen;
    };

    Chess.prototype.board = function () {
        const result = [];
        for (let rank = 0; rank < 8; rank++) {
            const row = [];
            for (let file = 0; file < 8; file++) {
                const piece = this.board_state[rank][file];
                row.push(piece ? { type: piece.type, color: piece.color } : null);
            }
            result.push(row);
        }
        return result;
    };

    Chess.prototype.get = function (square) {
        const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
        const rank = 8 - Number(square[1]);
        if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
        const piece = this.board_state[rank][file];
        return piece ? { type: piece.type, color: piece.color } : null;
    };

    Chess.prototype.turn = function () {
        return this.turn_color;
    };

    Chess.prototype.moves = function (options) {
        options = options || {};
        const moves = [];
        const verbose = options.verbose || false;
        const square = options.square;

        for (let rank = 0; rank < 8; rank++) {
            for (let file = 0; file < 8; file++) {
                const piece = this.board_state[rank][file];
                if (!piece || piece.color !== this.turn_color) continue;
                if (square) {
                    const target_file = square.charCodeAt(0) - 'a'.charCodeAt(0);
                    const target_rank = 8 - Number(square[1]);
                    if (file !== target_file || rank !== target_rank) continue;
                }

                const piece_moves = this.get_piece_moves(rank, file, piece);
                piece_moves.forEach((to_pos) => {
                    const from_file = file;
                    const from_rank = rank;
                    const to_file = to_pos[1];
                    const to_rank = to_pos[0];

                    if (this.is_valid_move(from_rank, from_file, to_rank, to_file, piece)) {
                        const from_square = String.fromCharCode('a'.charCodeAt(0) + from_file) + (8 - from_rank);
                        const to_square = String.fromCharCode('a'.charCodeAt(0) + to_file) + (8 - to_rank);

                        if (verbose) {
                            moves.push({
                                from: from_square,
                                to: to_square,
                                piece: piece.type,
                                captured: this.board_state[to_rank][to_file]?.type || null,
                                promotion: null,
                                flags: '',
                            });
                        } else {
                            moves.push(from_square + to_square);
                        }
                    }
                });
            }
        }

        return moves;
    };

    Chess.prototype.get_piece_moves = function (rank, file, piece) {
        const moves = [];
        const directions = {
            p: piece.color === WHITE ? [[-1, 0], [-1, -1], [-1, 1]] : [[1, 0], [1, -1], [1, 1]],
            n: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
            b: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
            r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
            q: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
            k: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
        };

        const type = piece.type;
        const dirs = directions[type] || [];

        if (type === 'p') {
            const dir = piece.color === WHITE ? -1 : 1;
            const forward = rank + dir;
            if (forward >= 0 && forward < 8 && !this.board_state[forward][file]) {
                moves.push([forward, file]);
            }
            if (forward >= 0 && forward < 8) {
                [-1, 1].forEach((df) => {
                    if (file + df >= 0 && file + df < 8 && this.board_state[forward][file + df]) {
                        moves.push([forward, file + df]);
                    }
                });
            }
        } else if (type === 'n') {
            dirs.forEach(([dr, df]) => {
                const nr = rank + dr;
                const nf = file + df;
                if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
                    moves.push([nr, nf]);
                }
            });
        } else if (type === 'b' || type === 'r' || type === 'q') {
            dirs.forEach(([dr, df]) => {
                for (let i = 1; i < 8; i++) {
                    const nr = rank + dr * i;
                    const nf = file + df * i;
                    if (nr < 0 || nr > 7 || nf < 0 || nf > 7) break;
                    if (this.board_state[nr][nf]) {
                        if (this.board_state[nr][nf].color !== piece.color) {
                            moves.push([nr, nf]);
                        }
                        break;
                    }
                    moves.push([nr, nf]);
                }
            });
        } else if (type === 'k') {
            dirs.forEach(([dr, df]) => {
                const nr = rank + dr;
                const nf = file + df;
                if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
                    moves.push([nr, nf]);
                }
            });
        }

        return moves;
    };

    Chess.prototype.is_valid_move = function (from_rank, from_file, to_rank, to_file, piece) {
        if (to_rank < 0 || to_rank > 7 || to_file < 0 || to_file > 7) return false;
        const target = this.board_state[to_rank][to_file];
        if (target && target.color === piece.color) return false;
        return true;
    };

    Chess.prototype.move = function (move_obj) {
        const from = move_obj.from;
        const to = move_obj.to;
        const from_file = from.charCodeAt(0) - 'a'.charCodeAt(0);
        const from_rank = 8 - Number(from[1]);
        const to_file = to.charCodeAt(0) - 'a'.charCodeAt(0);
        const to_rank = 8 - Number(to[1]);

        const piece = this.board_state[from_rank][from_file];
        if (!piece) return null;
        if (piece.color !== this.turn_color) return null;

        const moves = this.moves({ square: from, verbose: true });
        const is_legal = moves.some((m) => m.to === to);
        if (!is_legal) return null;

        const captured = this.board_state[to_rank][to_file];
        this.board_state[to_rank][to_file] = piece;
        this.board_state[from_rank][from_file] = null;

        if (piece.type === 'p' && (to_rank === 0 || to_rank === 7)) {
            piece.type = move_obj.promotion || 'q';
        }

        this.move_history.push({ from, to, piece, captured });
        this.turn_color = this.turn_color === WHITE ? BLACK : WHITE;

        return { from, to, piece: piece.type, color: piece.color === WHITE ? 'w' : 'b', captured };
    };

    Chess.prototype.undo = function () {
        if (this.move_history.length === 0) return null;
        const last_move = this.move_history.pop();
        const from_file = last_move.from.charCodeAt(0) - 'a'.charCodeAt(0);
        const from_rank = 8 - Number(last_move.from[1]);
        const to_file = last_move.to.charCodeAt(0) - 'a'.charCodeAt(0);
        const to_rank = 8 - Number(last_move.to[1]);

        this.board_state[from_rank][from_file] = last_move.piece;
        this.board_state[to_rank][to_file] = last_move.captured;

        this.turn_color = this.turn_color === WHITE ? BLACK : WHITE;
        return last_move;
    };

    Chess.prototype.in_check = Chess.prototype.inCheck = function () {
        return false;
    };

    Chess.prototype.in_checkmate = Chess.prototype.isCheckmate = function () {
        return this.moves().length === 0;
    };

    Chess.prototype.in_stalemate = Chess.prototype.isStalemate = function () {
        return !this.inCheck() && this.moves().length === 0;
    };

    Chess.prototype.in_draw = Chess.prototype.isDraw = function () {
        return this.isStalemate();
    };

    Chess.prototype.insufficient_material = Chess.prototype.isInsufficientMaterial = function () {
        return false;
    };

    Chess.prototype.threefold_repetition = Chess.prototype.isThreefoldRepetition = function () {
        return false;
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Chess;
    } else {
        global.Chess = Chess;
    }
})(typeof window !== 'undefined' ? window : global);
