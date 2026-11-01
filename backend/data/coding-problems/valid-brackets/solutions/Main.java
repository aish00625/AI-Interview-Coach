import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        String s = in.nextLine().trim();
        Deque<Character> stack = new ArrayDeque<>();
        boolean ok = true;
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') { stack.push(c); continue; }
            if (stack.isEmpty()) { ok = false; break; }
            char o = stack.pop();
            if ((c == ')' && o != '(') || (c == ']' && o != '[') || (c == '}' && o != '{')) { ok = false; break; }
        }
        System.out.println(ok && stack.isEmpty() ? "YES" : "NO");
    }
}
