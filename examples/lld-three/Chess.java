package lldthree;

import java.util.*;

/** Standard-chess movement/core results. No clocks, networking or tournament draw adjudication. */
public final class Chess {
    private Chess() {}
    // region:values
    public enum Side { WHITE, BLACK;
        public Side other() { return this == WHITE ? BLACK : WHITE; }
        int step() { return this == WHITE ? 1 : -1; }
    }
    public enum Kind { KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN }
    public record Piece(Side side, Kind kind) {
        public Piece { Objects.requireNonNull(side); Objects.requireNonNull(kind); }
    }
    public record Square(int file, int rank) {
        public Square {
            if (file < 0 || file > 7 || rank < 0 || rank > 7)
                throw new IllegalArgumentException("Square outside board");
        }
        public static Square at(String s) {
            if (s == null || !s.matches("[a-h][1-8]")) throw new IllegalArgumentException("Bad square");
            return new Square(s.charAt(0) - 'a', s.charAt(1) - '1');
        }
        int index() { return rank * 8 + file; }
        @Override public String toString() { return "" + (char)('a' + file) + (rank + 1); }
    }
    public record Move(Square from, Square to, Kind promotion) {
        public Move { Objects.requireNonNull(from); Objects.requireNonNull(to); }
        public static Move of(String from, String to) { return new Move(Square.at(from), Square.at(to), null); }
        public static Move promote(String from, String to, Kind kind) { return new Move(Square.at(from), Square.at(to), kind); }
    }
    public enum Result { ACTIVE, WHITE_WINS, BLACK_WINS, STALEMATE, AGREED_DRAW }
    // endregion:values

    public static final class Position {
        private final Piece[] board;
        private final Side turn;
        private final int castlingRights;
        private final Square enPassant;
        private final int halfmoveClock, fullmoveNumber;
        private Position(Piece[] board, Side turn, int rights, Square ep, int half, int full) {
            this.board = board.clone(); this.turn = turn; this.castlingRights = rights;
            this.enPassant = ep; this.halfmoveClock = half; this.fullmoveNumber = full;
        }
        public Piece at(Square square) { return board[square.index()]; }
        public Side turn() { return turn; }
        public Square enPassant() { return enPassant; }
        public int halfmoveClock() { return halfmoveClock; }
        public int fullmoveNumber() { return fullmoveNumber; }
        public int castlingRights() { return castlingRights; }
        public static Position initial() { return fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); }
        /** Fixture/import parser, not proof that arbitrary FEN is a historically reachable position. */
        public static Position fromFen(String fen) {
            String[] p = fen.trim().split("\\s+");
            if (p.length != 6) throw new IllegalArgumentException("Six FEN fields required");
            String[] rows = p[0].split("/");
            if (rows.length != 8) throw new IllegalArgumentException("Eight ranks required");
            Piece[] b = new Piece[64];
            for (int r = 0; r < 8; r++) {
                int file = 0;
                for (char c : rows[r].toCharArray()) {
                    if (c >= '1' && c <= '8') file += c - '0';
                    else {
                        if (file >= 8) throw new IllegalArgumentException("Rank overflow");
                        Kind kind = switch (Character.toLowerCase(c)) {
                            case 'k' -> Kind.KING; case 'q' -> Kind.QUEEN; case 'r' -> Kind.ROOK;
                            case 'b' -> Kind.BISHOP; case 'n' -> Kind.KNIGHT; case 'p' -> Kind.PAWN;
                            default -> throw new IllegalArgumentException("Unknown piece");
                        };
                        b[(7-r)*8 + file++] = new Piece(Character.isUpperCase(c) ? Side.WHITE : Side.BLACK, kind);
                    }
                }
                if (file != 8) throw new IllegalArgumentException("Rank width");
            }
            Side side = switch (p[1]) { case "w" -> Side.WHITE; case "b" -> Side.BLACK; default -> throw new IllegalArgumentException("Bad turn"); };
            int rights = 0;
            for (char c : p[2].toCharArray()) rights |= switch(c) { case 'K' -> 1; case 'Q' -> 2; case 'k' -> 4; case 'q' -> 8; case '-' -> 0; default -> throw new IllegalArgumentException("Bad rights"); };
            Square ep = p[3].equals("-") ? null : Square.at(p[3]);
            if (ep != null && ep.rank != 2 && ep.rank != 5) throw new IllegalArgumentException("Bad en passant rank");
            int half = Integer.parseInt(p[4]), full = Integer.parseInt(p[5]);
            if (half < 0 || full < 1) throw new IllegalArgumentException("Bad counters");
            Position result = new Position(b, side, rights, ep, half, full);
            king(result, Side.WHITE); king(result, Side.BLACK);
            return result;
        }
        public String fingerprint() { return Arrays.toString(board)+turn+castlingRights+enPassant+":"+halfmoveClock+":"+fullmoveNumber; }
    }

    public interface RuleSet {
        List<Move> legalMoves(Position position);
        Position play(Position position, Move move);
        boolean inCheck(Position position, Side side);
    }
    public static final class StandardRules implements RuleSet {
        // region:legal
        @Override public Position play(Position before, Move move) {
            if (!pseudoLegal(before, move)) throw new IllegalArgumentException("Illegal geometry or precondition");
            Position trial = applyUnchecked(before, move);
            if (inCheck(trial, before.turn)) throw new IllegalArgumentException("Own king exposed");
            return trial;
        }
        @Override public List<Move> legalMoves(Position p) {
            List<Move> legal = new ArrayList<>();
            for (int i = 0; i < 64; i++) {
                Piece piece = p.board[i];
                if (piece == null || piece.side != p.turn) continue;
                Square from = square(i);
                for (int j = 0; j < 64; j++) {
                    Square to = square(j);
                    Kind[] choices = piece.kind == Kind.PAWN && (to.rank == 0 || to.rank == 7)
                        ? new Kind[]{Kind.QUEEN, Kind.ROOK, Kind.BISHOP, Kind.KNIGHT} : new Kind[]{null};
                    for (Kind promotion : choices) {
                        Move move = new Move(from, to, promotion);
                        if (pseudoLegal(p, move) && !inCheck(applyUnchecked(p, move), p.turn)) legal.add(move);
                    }
                }
            }
            return List.copyOf(legal);
        }
        @Override public boolean inCheck(Position p, Side side) { return attacked(p, king(p, side), side.other()); }
        // endregion:legal

        private boolean pseudoLegal(Position p, Move m) {
            Piece moving = p.at(m.from), target = p.at(m.to);
            if (moving == null || moving.side != p.turn || m.from.equals(m.to)) return false;
            if (target != null && (target.side == moving.side || target.kind == Kind.KING)) return false;
            int dx = m.to.file-m.from.file, dy=m.to.rank-m.from.rank;
            boolean promotes = moving.kind == Kind.PAWN && (m.to.rank == 0 || m.to.rank == 7);
            if (promotes && !EnumSet.of(Kind.QUEEN,Kind.ROOK,Kind.BISHOP,Kind.KNIGHT).contains(m.promotion)) return false;
            if (!promotes && m.promotion != null) return false;
            return switch (moving.kind) {
                case ROOK -> (dx == 0 || dy == 0) && pathClear(p,m.from,m.to);
                case BISHOP -> Math.abs(dx)==Math.abs(dy) && pathClear(p,m.from,m.to);
                case QUEEN -> (dx==0 || dy==0 || Math.abs(dx)==Math.abs(dy)) && pathClear(p,m.from,m.to);
                case KNIGHT -> Math.abs(dx)*Math.abs(dy)==2;
                case KING -> Math.max(Math.abs(dx),Math.abs(dy))==1 || castleAllowed(p,m);
                case PAWN -> pawnAllowed(p,m,moving,target,dx,dy);
            };
        }
        private boolean pawnAllowed(Position p, Move m, Piece moving, Piece target, int dx, int dy) {
            int step=moving.side.step(), start=moving.side==Side.WHITE?1:6;
            if (dx==0 && target==null) {
                if (dy==step) return true;
                return dy==2*step && m.from.rank==start && p.at(new Square(m.from.file,m.from.rank+step))==null;
            }
            if (Math.abs(dx)!=1 || dy!=step) return false;
            if (target!=null) return true;
            Piece captured=p.at(new Square(m.to.file,m.from.rank));
            return m.to.equals(p.enPassant) && captured!=null && captured.side!=moving.side && captured.kind==Kind.PAWN;
        }
        // region:attacks
        public boolean attacked(Position p, Square target, Side by) {
            for (int i=0;i<64;i++) {
                Piece piece=p.board[i]; if (piece==null || piece.side!=by) continue;
                Square from=square(i); int dx=target.file-from.file, dy=target.rank-from.rank;
                boolean attacks=switch(piece.kind) {
                    case PAWN -> Math.abs(dx)==1 && dy==by.step();
                    case KNIGHT -> Math.abs(dx)*Math.abs(dy)==2;
                    case KING -> Math.max(Math.abs(dx),Math.abs(dy))==1;
                    case ROOK -> (dx==0 || dy==0) && pathClear(p,from,target);
                    case BISHOP -> Math.abs(dx)==Math.abs(dy) && pathClear(p,from,target);
                    case QUEEN -> (dx==0 || dy==0 || Math.abs(dx)==Math.abs(dy)) && pathClear(p,from,target);
                };
                if (!from.equals(target) && attacks) return true;
            }
            return false;
        }
        // endregion:attacks

        private boolean castleAllowed(Position p, Move m) {
            int rank=p.turn==Side.WHITE?0:7;
            if (!m.from.equals(new Square(4,rank)) || m.to.rank!=rank || (m.to.file!=2 && m.to.file!=6)) return false;
            boolean kingSide=m.to.file==6;
            int required=right(p.turn,kingSide);
            if ((p.castlingRights&required)==0) return false;
            Square rookFrom=new Square(kingSide?7:0,rank);
            Piece rook=p.at(rookFrom);
            if (rook==null || rook.side!=p.turn || rook.kind!=Kind.ROOK || !pathClear(p,m.from,rookFrom)) return false;
            if (inCheck(p,p.turn)) return false;
            Square crossing=new Square(kingSide?5:3,rank);
            Piece[] mid=p.board.clone();mid[m.from.index()]=null;mid[crossing.index()]=p.at(m.from);
            Position trial=new Position(mid,p.turn,p.castlingRights,null,p.halfmoveClock,p.fullmoveNumber);
            // Destination safety is checked on the fully applied king+rook position by play().
            return !attacked(trial,crossing,p.turn.other());
        }
        // region:apply
        private Position applyUnchecked(Position p, Move m) {
            Piece[] b=p.board.clone(); Piece moving=p.at(m.from), captured=p.at(m.to);
            boolean pawn=moving.kind==Kind.PAWN;
            boolean ep=pawn && m.from.file!=m.to.file && captured==null;
            if (ep) { Square capture=new Square(m.to.file,m.from.rank);captured=b[capture.index()];b[capture.index()]=null; }
            b[m.from.index()]=null;
            b[m.to.index()]=m.promotion==null?moving:new Piece(moving.side,m.promotion);
            if (moving.kind==Kind.KING && Math.abs(m.to.file-m.from.file)==2) {
                int rookFrom=m.to.file==6?7:0, rookTo=m.to.file==6?5:3;
                b[new Square(rookTo,m.from.rank).index()]=b[new Square(rookFrom,m.from.rank).index()];
                b[new Square(rookFrom,m.from.rank).index()]=null;
            }
            int rights=p.castlingRights;
            if (moving.kind==Kind.KING) rights &= ~(right(moving.side,true)|right(moving.side,false));
            if (moving.kind==Kind.ROOK) rights=clearRookRight(rights,m.from,moving.side);
            if (captured!=null && captured.kind==Kind.ROOK) rights=clearRookRight(rights,m.to,captured.side);
            Square epTarget=pawn && Math.abs(m.to.rank-m.from.rank)==2
                ? new Square(m.from.file,(m.from.rank+m.to.rank)/2):null;
            return new Position(b,p.turn.other(),rights,epTarget,
                pawn||captured!=null?0:p.halfmoveClock+1,p.fullmoveNumber+(p.turn==Side.BLACK?1:0));
        }
        // endregion:apply
    }

    public static final class Game {
        private Position position; private long version; private Result result=Result.ACTIVE;
        private final RuleSet rules; private final Deque<Frame> history=new ArrayDeque<>();
        private record Frame(Position position,Result result) {}
        public record View(Position position,long version,Result result,boolean check) {}
        public Game() { this(Position.initial(),new StandardRules()); }
        public Game(Position p,RuleSet rules) { this.position=Objects.requireNonNull(p);this.rules=Objects.requireNonNull(rules);result=evaluate(p); }
        // region:game
        public synchronized View move(Side actor,long expectedVersion,Move move) {
            requireActive(expectedVersion);
            if (actor!=position.turn) throw new IllegalArgumentException("Wrong side to move");
            Position next=rules.play(position,move); // May fail; no live state has changed.
            Result nextResult=evaluate(next);
            history.push(new Frame(position,result));
            position=next;result=nextResult;version++;
            return view();
        }
        public synchronized View undo(long expectedVersion) {
            if (expectedVersion!=version) throw new IllegalStateException("Stale version");
            if (history.isEmpty()) throw new IllegalStateException("No history");
            Frame before=history.pop();position=before.position;result=before.result;
            version++; // Monotonic: an old command must not become valid again after undo.
            return view();
        }
        private Result evaluate(Position p) {
            if (!rules.legalMoves(p).isEmpty()) return Result.ACTIVE;
            if (!rules.inCheck(p,p.turn)) return Result.STALEMATE;
            return p.turn==Side.WHITE?Result.BLACK_WINS:Result.WHITE_WINS;
        }
        // endregion:game
        public synchronized View resign(Side actor,long expectedVersion) {
            requireActive(expectedVersion);Objects.requireNonNull(actor);
            history.push(new Frame(position,result));result=actor==Side.WHITE?Result.BLACK_WINS:Result.WHITE_WINS;version++;return view();
        }
        /** Caller supplies authenticated consent identities; not raw client boolean assertions. */
        public synchronized View agreeDraw(Set<Side> consentingSides,long expectedVersion) {
            requireActive(expectedVersion);
            if (!consentingSides.containsAll(EnumSet.allOf(Side.class))) throw new IllegalArgumentException("Both consents required");
            history.push(new Frame(position,result));result=Result.AGREED_DRAW;version++;return view();
        }
        public synchronized View view() { return new View(position,version,result,rules.inCheck(position,position.turn)); }
        private void requireActive(long expected) {
            if (expected!=version) throw new IllegalStateException("Stale version");
            if (result!=Result.ACTIVE) throw new IllegalStateException("Game finished");
        }
    }
    private static Square square(int index) { return new Square(index%8,index/8); }
    private static Square king(Position p,Side side) {
        Square result=null;
        for(int i=0;i<64;i++) if(p.board[i]!=null && p.board[i].side==side && p.board[i].kind==Kind.KING) {
            if(result!=null)throw new IllegalArgumentException("Two kings of one side");result=square(i);
        }
        if(result==null)throw new IllegalArgumentException("Missing king");return result;
    }
    private static boolean pathClear(Position p,Square from,Square to) {
        int dx=Integer.signum(to.file-from.file),dy=Integer.signum(to.rank-from.rank);
        int f=from.file+dx,r=from.rank+dy;
        while(f!=to.file || r!=to.rank) {if(p.at(new Square(f,r))!=null)return false;f+=dx;r+=dy;}
        return true;
    }
    private static int right(Side side,boolean kingSide) { return side==Side.WHITE?(kingSide?1:2):(kingSide?4:8); }
    private static int clearRookRight(int rights,Square square,Side side) {
        int rank=side==Side.WHITE?0:7;
        if(square.equals(new Square(0,rank)))return rights&~right(side,false);
        if(square.equals(new Square(7,rank)))return rights&~right(side,true);
        return rights;
    }
}
