# School Timetabling Engine: System Architecture, Data Model & Algorithmic Blueprint
*(Modeled on the aSc Timetables & EduPage Ecosystem)*

---

## 1. Executive Overview & 5-Layer Data Architecture

A commercial-grade school timetabling system like **aSc Timetables** operates as a relational constraint-satisfaction pipeline. It ingests static school resources and pedagogical rules, compiles them into discrete scheduling units ("Cards"), solves a multi-dimensional combinatorial optimization problem, and exports the resulting master schedule into daily operational modules (such as **aSc Substitutions** and **EduPage**).

| Data Layer | Core Entities / Objects | Key Data Attributes | Role in Data Flow |
| :--- | :--- | :--- | :--- |
| **1. Temporal Grid** | `Days`, `Periods`, `Bell Times`, `Weeks/Terms` | Cycle length (e.g., 5-day week or 10-day cycle), periods per day ($0$ to $N$), break slots | Defines the empty multi-dimensional coordinate matrix ($\text{Term} \times \text{Week} \times \text{Day} \times \text{Period}$) into which all lessons must fit. |
| **2. Master Entities** | `Subjects`, `Classes`, `Groups`, `Classrooms`, `Teachers` | Entity IDs, abbreviations, color codes, home classrooms, building IDs, and class **Divisions** | Supplies the raw actors and physical spaces. Data enters via UI wizards or XML/API sync from a Student Information System (SIS). |
| **3. Lesson Contracts** | `Lessons` (Contract definitions) & `Cards` (Unplaced instances) | `TEACHER_IDS` + `SUBJECT_ID` + `CLASS_IDS` / `GROUP_IDS` + `Duration` + `Frequency` + `Room Pool` | Acts as the central junction object. A lesson of "Maths $4$ times a week" generates $4$ unplaced **Cards** in the scheduling pool. |
| **4. Constraint Matrix** | `Time-Off Grids`, `Card Relationships`, `Entity Rules` | Availability states (`1` = OK, `?` = Soft Avoid, `0` = Forbidden), max consecutive lessons, gap limits, building buffers | Filters valid domain slots for each card and defines **Hard Constraints** (must never break) vs. **Soft Constraints** (optimization goals). |
| **5. Output & Sync State** | `Placed Cards`, `Substitutions`, `Attendance Registers` | Assigned $\text{Lesson ID} + \text{Day} + \text{Period} + \text{Classroom ID(s)}$ | Populates master views (by Class, Teacher, Room) and feeds downstream daily substitution and class register workflows. |

---

## 2. End-to-End Operational Process Flow (The 6-Stage Lifecycle)

When designing both the user onboarding flow and the backend state machine, the application should guide users through six sequential stages:

### Stage 1: Temporal & Structural Initialization
1. **School Parameters:** Define the academic year, number of days in a cycle ($D$), and daily period structure ($P$, including Period $0$ for early classes).
2. **Multi-Building & Bell Setup:** Configure custom bell times if primary and secondary sections run on staggered schedules, and define inter-building travel rules (e.g., minimum $1$ period buffer or max $1$ building transition per day) if teachers commute between campuses.

### Stage 2: Master Data Ingestion & Group Divisions
1. **Entity Creation / Import:** Populate **Subjects**, **Classes**, **Classrooms**, and **Teachers** manually or via XML/API import.
2. **Class Divisions:** Each class contains a default `Whole Class` group, plus mutually exclusive **Divisions** (e.g., splitting Grade 9A into *Group 1 / Group 2* for labs, and *Boys / Girls* for PE). This allows the engine to schedule multiple lessons for the same class in the same period without flagging a collision, provided they belong to disjoint sub-groups within the same division.

### Stage 3: Lesson Allocation (Contract Binding)
1. **Binding Entities:** Create **Lessons** (teacher contracts) linking:
   * **Who:** One or more teachers (supporting co-teaching).
   * **What:** A subject.
   * **Whom:** One class, a specific subgroup, or merged subgroups across multiple classes (e.g., Grade 10A French + Grade 10B French).
   * **Duration & Frequency:** How many times per cycle and how many consecutive periods per session (Single $= 1$, Double $= 2$, Triple $= 3$).
   * **Where:** Allowed classroom pool (e.g., Home Classroom, specific lab, or any room from a shared pool).
2. **Card Instantiation:** Each weekly occurrence becomes an unplaced **Card** in the holding dock.

### Stage 4: Pre-Generation Verification & Draft Run
1. **Specification Test:** Before running the solver, execute a static mathematical audit of the input data to catch impossible configurations (e.g., a class assigned $42$ periods in a $40$-period week, or $50$ periods of Physics Lab requested across a $40$-period week with only $1$ lab).
2. **Draft Generation:** Run an initial generation with minimal soft constraints to verify that class divisions and core contracts fit together cleanly.

### Stage 5: Iterative Constraint Layering & Algorithmic Generation
1. **Time-Off & Rule Configuration:** Apply individual **Time-Off** matrices and **Card Relationships** (e.g., forcing two subjects not to occur on the same day, or requiring a minimum break between double periods).
2. **Heuristic CSP Engine Execution:**
   * **Domain Filtering & Placement:** Places high-difficulty cards first (multi-class merged electives, scarce lab blocks, triple periods).
   * **Recursive Chain Swapping:** When a card cannot be placed without a collision, the algorithm unplaces blocking cards and recursively swaps chains of lessons across days and rooms.
   * **Constraint Relaxation:** Optionally bends lower-priority rules to complete the grid and outputs a diagnostic report showing which constraint caused the bottleneck.

### Stage 6: Manual Locking, Publishing & Daily Substitution Loop
1. **Manual Adjustments & Locking:** Users drag and drop placed cards on an interactive grid (which highlights valid slots and room availability in real time) and **Lock** finalized rows.
2. **Downstream Distribution & Daily Substitutions:** Published schedules sync to cloud portals. When a teacher is absent, the substitution module queries the live master timetable, identifies affected cards, scores available free teachers (weighing subject qualification, daily load, and substitution balance), and publishes daily cover rosters.

---

## 3. Relational Database & XML Schema Specification

If you are building a compatible system, your database schema (and import/export format) should mirror the relational structure below. This structure is also directly compatible with the native **aSc Timetables XML** specification.

### 3.1 Core Relational Tables (SQL / JSON Blueprint)

#### `periods` (Daily Time Slots)
* `id` (PK, Integer/String): `1`, `2`, `3`...
* `name` (String): `"Period 1"`
* `short_name` (String): `"P1"`
* `start_time` (Time): `"08:00"`
* `end_time` (Time): `"08:45"`

#### `days_defs` (Cycle Days & Combinatorial Masks)
* `id` (PK, String)
* `name` (String): `"Monday"`, `"Tuesday"`...
* `short_name` (String): `"Mon"`
* `day_bitmask` (Bitmask String): `"10000"`, `"01000"`, or `"11111"` (for every day).

#### `buildings` & `classrooms`
* `id` (PK, UUID/String)
* `name` (String): `"Physics Lab 1"`
* `short_name` (String): `"PHY1"`
* `building_id` (FK $\rightarrow$ `buildings.id`)
* `capacity` (Integer)
* `time_off_matrix` (2D Array / Bitmask of size $D \times P$): Availability states (`AVAILABLE`, `QUESTIONABLE`, `FORBIDDEN`).

#### `subjects`
* `id` (PK, UUID/String)
* `name` (String): `"Mathematics"`
* `short_name` (String): `"MATH"`
* `color` (Hex String)
* `default_classroom_ids` (Array of FK $\rightarrow$ `classrooms.id`)

#### `teachers`
* `id` (PK, UUID/String)
* `name`, `short_name`, `color`, `email`
* `time_off_matrix` ($D \times P$ matrix)
* `max_gaps_per_week` (Integer, nullable)
* `max_gaps_per_day` (Integer, nullable)
* `max_lessons_per_day` (Integer, nullable)
* `min_lessons_per_day` (Integer, nullable)
* `max_consecutive_lessons` (Integer, default $4$)
* `max_days_per_week` (Integer, for part-time staff)
* `max_building_transfers_per_day` (Integer)

#### `classes`, `divisions`, and `groups`
* **`classes`**:
  * `id` (PK), `name` (`"Grade 10A"`), `short_name` (`"10A"`), `teacher_id` (Homeroom teacher FK), `home_classroom_id` (FK), `time_off_matrix` ($D \times P$).
* **`divisions`** (Represents a way of splitting a class):
  * `id` (PK), `class_id` (FK $\rightarrow$ `classes.id`), `name` (`"Language Split"`).
* **`groups`**:
  * `id` (PK)
  * `class_id` (FK $\rightarrow$ `classes.id`)
  * `division_id` (FK $\rightarrow$ `divisions.id`, `NULL` if `entire_class = true`)
  * `name` (String): `"Entire Class"`, `"Group 1"`, `"Group 2"`
  * `entire_class` (Boolean)
  * `atomic_subgroup_mask` (64-bit Integer — *see Section 4 for how this powers fast collision detection*).

#### `lessons` (The Scheduling Contracts)
* `id` (PK, UUID/String)
* `subject_id` (FK $\rightarrow$ `subjects.id`)
* `teacher_ids` (Array of FK $\rightarrow$ `teachers.id` — supports multiple teachers for co-taught classes)
* `class_ids` (Array of FK $\rightarrow$ `classes.id` — supports joint/merged classes)
* `group_ids` (Array of FK $\rightarrow$ `groups.id` — specifies which sub-groups from each class attend)
* `periods_per_card` (Integer): $1$ (Single), $2$ (Double), $3$ (Triple)
* `cards_per_week` (Integer): Total occurrences per cycle (e.g., $4$)
* `classroom_group_pools` (2D Array of FK $\rightarrow$ `classrooms.id`): If a lesson requires $2$ rooms simultaneously, this contains $2$ arrays of valid candidate rooms.

#### `cards` (Individual Placed or Unplaced Instances)
* `id` (PK, UUID/String)
* `lesson_id` (FK $\rightarrow$ `lessons.id`)
* `day_index` (Integer, `NULL` if unplaced)
* `period_index` (Integer, `NULL` if unplaced — marks the starting period if `periods_per_card` $> 1$)
* `assigned_classroom_ids` (Array of FK $\rightarrow$ `classrooms.id`, empty if unplaced)
* `is_locked` (Boolean): Prevents the generator from moving this card.

---

## 4. The Mathematics of Class Divisions & Fast Collision Detection

One of the hardest problems when rebuilding aSc Timetables is handling **Class Divisions** without false collisions or missed overlaps.

### The Problem
Suppose **Class 10A** has two independent divisions:
* **Division A (Gender):** `Boys` | `Girls`
* **Division B (Elective):** `French` | `German`

Now consider three rules:
1. `Boys` (PE) and `Girls` (PE) **CAN** be scheduled in the same period (they belong to the *same* division and are disjoint).
2. `French` and `German` **CAN** be scheduled in the same period (they belong to the *same* division and are disjoint).
3. `Boys` (PE) and `French` **CANNOT** be scheduled in the same period because some Boys take French! (They belong to *different* divisions of the same class, so their student sets intersect: $\text{Boys} \cap \text{French} \neq \emptyset$).

### The Solution: Atomic Subgroup Bitmasks ($O(1)$ Lookup)
Instead of running slow database queries during timetable generation, pre-compile each class's divisions into **Atomic Subgroups** (the Cartesian product of all divisions within that class) and assign a **Bitmask** to every group:

For Class 10A above, the Cartesian product of $\text{Division A} \times \text{Division B}$ produces $2 \times 2 = 4$ atomic student buckets:
* Bit $0$ ($2^0 = 1$): $(\text{Boys}, \text{French})$
* Bit $1$ ($2^1 = 2$): $(\text{Boys}, \text{German})$
* Bit $2$ ($2^2 = 4$): $(\text{Girls}, \text{French})$
* Bit $3$ ($2^3 = 8$): $(\text{Girls}, \text{German})$

Now, every group in Class 10A is represented as a single integer bitmask:
* `Entire Class` $= 1111_2 = 15$
* `Boys` $= 0011_2 = 3$
* `Girls` $= 1100_2 = 12$
* `French` $= 0101_2 = 5$
* `German` $= 1010_2 = 10$

When the solver checks if two cards for Class 10A can be placed in the same `(Day, Period)` slot, it performs a single CPU bitwise `AND` operation:
* `Boys` $\land$ `Girls` $\rightarrow 0011_2 \land 1100_2 = 0000_2 = 0$ $\rightarrow$ **No Collision!**
* `Boys` $\land$ `French` $\rightarrow 0011_2 \land 0101_2 = 0001_2 \neq 0$ $\rightarrow$ **Collision Detected!**

This allows your solver to maintain an occupancy state `class_slot_mask[class_id][day][period]` and check or update class availability in $O(1)$ constant time.

---

## 5. Comprehensive Constraint Catalog (Card Relationships & Entity Rules)

In aSc Timetables, besides basic Time-Off grids, advanced rules are stored as **Card Relationships** and **Entity Constraints**. Your engine should divide these into **Hard Constraints** (must be satisfied for a valid timetable) and **Soft Constraints** (evaluated via a weighted penalty cost function).

### 5.1 Hard Constraints (Inviolable unless Relaxation is enabled)
1. **No Resource Double-Booking:**
   * A teacher cannot teach two separate cards at the same `(day, period)`.
   * A classroom cannot host two separate cards at the same `(day, period)`.
   * For any class $c$ and slot $(d, p)$, the bitwise `AND` of any two placed cards' group masks must equal $0$.
2. **Multi-Period Continuity:** A card with duration $L > 1$ placed at period $p$ occupies $[p, p + L - 1]$ on the same day, cannot span across a prohibited break (e.g., lunch break if configured as unbridgeable), and cannot exceed $P$.
3. **Forbidden Time-Off (`0` / Red Slots):** Neither teacher, class, subject, nor assigned classroom can be scheduled on a slot marked `FORBIDDEN`.
4. **Same-Day Same-Lesson Prevention (Default Hard/Configurable):** Two cards belonging to the same `lesson_id` cannot be placed on the same day (unless explicitly configured to allow multiple cards per day).
5. **Synchronized / Locked Cards:** Cards linked by a "Must start at the same time" relationship must share identical `(day, period)` coordinates.

### 5.2 Soft Constraints & Card Relationships (Penalty-Driven)
Each rule below adds a configurable weight $w_k$ to the total penalty score $E(\text{State})$ when violated:

| Category | Constraint Type | Logic / Evaluation Formula |
| :--- | :--- | :--- |
| **Teacher Quality** | **Minimize Gaps (Windows)** | Penalize any empty period $p$ between a teacher's first and last lesson on day $d$. Enforce `max_gaps_per_day` and `max_gaps_per_week`. |
| **Teacher Load** | **Min / Max Lessons per Day** | If a teacher teaches on day $d$, their total periods on day $d$ must fall within $[L_{\min}, L_{\max}]$. |
| **Teacher Load** | **Max Working Days** | For part-time teachers, count active days $\sum_{d} \mathbb{I}(\text{lessons}_d > 0) \le D_{\max}$. |
| **Class Schedule** | **Zero Gaps & Early Start** | Classes (especially primary/secondary grades) must start at Period $1$ and have $0$ gaps until dismissal. |
| **Pedagogical** | **Subject Distribution Across Week** | Cards of the same lesson should be spread evenly (e.g., if $3\times$/week, prefer Mon-Wed-Fri over Mon-Tue-Wed). |
| **Pedagogical** | **Max Difficult Subjects at Late Periods** | Subjects flagged as high cognitive load can have a limit on how many times per week they appear after Period $5$. |
| **Card Relationship** | **Subjects Cannot Be on the Same Day** | Given Subject Set $\{S_A, S_B\}$ for Class $C$, penalize if both appear on the same day $d$ (e.g., Physics Lab and Chemistry Lab). |
| **Card Relationship** | **Consecutive Ordering ($A$ followed by $B$)** | Card $B$ must immediately follow Card $A$ on the same day ($p_B = p_A + L_A$). |
| **Card Relationship** | **Room Consistency across Week** | All cards of a specific `lesson_id` should be assigned the *same* classroom from the candidate pool throughout the week. |
| **Logistics** | **Building Transfers** | If a teacher or class has Card $A$ at $(d, p)$ in Building $1$ and Card $B$ at $(d, p+1)$ in Building $2$, apply a heavy penalty (or require $1$ free period between them). |

---

## 6. Pre-Generation Verification (The "Timetable $\rightarrow$ Test" Diagnostic)

Before running the solver, implement a deterministic pre-flight validator. This catches impossible human input errors in milliseconds rather than letting the solver spin forever:

1. **Class Volume Check:** For every atomic subgroup $g$ in class $c$, verify:
   $$\sum_{l \in \text{Lessons}(c, g)} (\text{periods\_per\_card}_l \times \text{cards\_per\_week}_l) \le |\text{AvailableSlots}(c)|$$
2. **Teacher Volume Check:** For every teacher $t$, verify total contracted periods $\le |\text{AvailableSlots}(t)|$.
3. **Pigeonhole Bottleneck Check on Time-Off Intersections:** For each lesson $l$, compute the intersection of available slots across all required teachers, classes, and at least one candidate classroom:
   $$\text{ValidDomain}(l) = \left( \bigcap_{t \in T_l} \text{Avail}(t) \right) \cap \left( \bigcap_{c \in C_l} \text{Avail}(c) \right) \cap \left( \bigcup_{r \in R_l} \text{Avail}(r) \right)$$
   If $|\text{ValidDomain}(l)| < \text{total\_periods}(l)$, immediately abort and show the user which entity's Time-Off grid is blocking the lesson.
4. **Classroom Pool Saturation Check:** Group all lessons that *exclusively* require a specific subset of rooms (e.g., `[Gym 1, Gym 2]`). If the sum of periods across those lessons exceeds $\text{Count(Rooms)} \times \text{AvailablePeriods}$, flag a room capacity shortage.

---

## 7. Algorithmic Solver Architecture (How the Generator Works)

Standard backtracking fails on real-world school timetables because of dense coupling (especially when classes are divided into subgroups and teachers are shared across grades). Commercial engines like aSc Timetables and open-source leaders like FET use a combination of **Heuristic Domain Ordering**, **Recursive Ejection Chains (Kempe-like Swaps)**, and **Local Search Metaheuristics**.

### Phase 1: Difficulty Scoring & Static Ordering
Sort all unplaced cards $v \in V$ in descending order of difficulty before starting placement:
$$\text{Difficulty}(v) = w_1 (\text{Duration}_v)^2 + w_2 |\text{Teachers}_v| + w_3 |\text{Classes}_v| + \frac{w_4}{|\text{InitialValidSlots}_v|} + \frac{w_5}{|\text{CandidateRooms}_v|}$$
* Cards locked by the user are placed first at depth $0$.
* Multi-class merged blocks, triple/double periods, and part-time teacher cards are placed next.
* Flexible single-period cards in homerooms are placed last.

### Phase 2: Constructive Placement with Recursive Ejection Chains
To place the current unplaced card $v$:
1. **Direct Placement:** Scan all valid `(day, period, room)` tuples in $D_v$. If a conflict-free slot exists, pick the one that causes the smallest increase in soft-constraint penalties $\Delta E_{\text{soft}}$.
2. **Recursive Swapping (Depth-Limited Ejection Chain):** If every slot in $D_v$ is blocked by already-placed cards:
   * Select a candidate slot $s = (d, p)$ that does not violate static Time-Off rules.
   * Identify the set of currently placed cards $B = \{b_1, b_2, \dots\}$ that conflict with $v$ at slot $s$ (because they use the same teacher, overlapping class subgroup mask, or room).
   * Temporarily unplace $B$, place $v$ at $s$, and recursively attempt to re-place each card $b_i \in B$ into an alternative slot (up to recursion depth $d_{\max} \approx 6$ to $14$, with a visited-state tabu list to prevent infinite loops).
   * If all $b_i \in B$ find valid homes, commit the swap chain!
3. **Random Restart / Kick Mechanism:** If a card $v$ cannot be placed after exhausting recursive swaps at depth $d_{\max}$, force-place $v$ into the slot with the fewest conflicts, eject the conflicting cards back into the unplaced pool, increment a conflict history weight on $v$ (so $v$ gets higher priority in future steps—known as **Conflict-Driven Clause/Weight Learning**), and continue.

### Phase 3: Soft-Constraint Optimization (Simulated Annealing / Tabu Search)
Once $100\%$ of cards are placed (hard conflicts $= 0$):
* Run an iterative improvement loop to eliminate teacher gaps, balance daily loads, and satisfy soft card relationships.
* Use **Kempe Chain Moves**: Select two periods $(d_1, p_1)$ and $(d_2, p_2)$, form the connected component of conflicting lessons between those two slots, and swap them simultaneously so no hard collisions are introduced while reducing the soft penalty score $E_{\text{soft}}$.

### Phase 4: Constraint Relaxation Mode
If the user enables **"Allow Relaxation of Constraints"**, convert non-essential hard constraints (such as `Same-Day Same-Lesson Prevention`, `Questionable (?) Time-Offs`, and `Max Consecutive Lessons`) into heavily weighted soft constraints ($W_{\text{relax}} = 10{,}000$). This allows the generator to finish placing all cards and return a **Diagnostic Relaxation Report** pinpointing the exact rules that had to be broken.

---

## 8. Interactive UI Matrix & Real-Time Drag-and-Drop Engine

To replicate the signature aSc Timetables user experience, the frontend state should maintain an in-memory spatial index:

1. **Multi-Perspective Master Grid:**
   * Rows can be switched dynamically between **Classes**, **Teachers**, **Classrooms**, or **Subjects**.
   * Columns represent $\text{Days} \times \text{Periods}$.
   * Divided lessons within a class cell are rendered as vertically stacked sub-bars proportional to their subgroup division (e.g., upper half `Group 1`, lower half `Group 2`).
2. **Instant Slot Highlighting on Card Selection:**
   * The moment a user clicks or drags a card $v$ (either from the bottom unplaced dock or from the grid), run a fast $O(D \times P)$ loop over all slots in the week:
     * **Green Highlight:** $0$ hard conflicts and $0$ soft conflicts.
     * **Yellow/Orange Highlight:** $0$ hard conflicts, but violates a soft constraint or requires a single-step classroom reassignment.
     * **Red Cross / Blocked:** Hard conflict with a locked card or forbidden Time-Off, along with a tooltip showing the exact blocking teacher, class, or room.
3. **Classroom Drop-Down Resolver:**
   * When placing or right-clicking a card on a slot, display all candidate classrooms from the lesson's room pool, visually marking which rooms are currently free vs. occupied at that `(day, period)`.

---

## 9. Daily Operations: The Substitution Engine (`aSc Substitutions`)

Once the master timetable is published, the daily operations module layers **Date-Specific Exceptions** on top of the cyclic schedule:

### Data Flow for Daily Substitutions
1. **Absence Input:** An administrator logs an absence for `Teacher T` (or a class field trip / room closure) for a specific date and period range.
2. **Affected Card Extraction:** The system queries all placed cards for that weekday where `Teacher T` is assigned, moving them into the **"Needs Substitution"** queue for that specific calendar date.
3. **Candidate Teacher Ranking Algorithm:** For each affected period $p$ on that date, the engine queries all teachers who have no placed card at period $p$ (and are not absent) and ranks them into categories:
   * **Same Class Teacher:** Teachers who already teach that specific class (enables swapping a lesson from another day or advancing curriculum).
   * **Same Subject Qualification:** Teachers who teach the same subject in the master timetable.
   * **Adjacent Period Availability:** Teachers who teach right before ($p-1$) or right after ($p+1$) in the same building, avoiding bringing a teacher in on their day off or extending their working span.
   * **Substitution Balance Score:** Tracks historical paid/unpaid cover counts over the term so substitutions are distributed fairly across staff.
4. **Action Types:**
   * **Assign Cover Teacher:** Replaces the teacher for that date/period.
   * **Join Classes:** Merges two subgroups or classes together under one remaining teacher.
   * **Move / Swap Lesson:** Moves a lesson from the end of the day into the empty gap so students can be dismissed early.
   * **Cancel Lesson:** Marks the period as cancelled/self-study.
5. **Notification & Register Sync:** Publishes the daily substitution sheet to hallway digital signage, printable PDFs, and push notifications, and updates the electronic class register so the covering teacher has write access to take attendance for that period.

---

## 10. Recommended Tech Stack for Rebuilding This System

If you are building a modern web/desktop equivalent of aSc Timetables from scratch, consider separating the **UI/CRUD Layer** from the **High-Performance Solver Engine**:

* **Solver Engine (CPU-Intensive):**
  * **Rust** or **C++** compiled to **WebAssembly (Wasm)** (for client-side offline generation in the browser/Electron) or run as a dedicated worker microservice.
  * Represent all entity IDs internally as contiguous $0$-indexed integers (`usize`) during generation, and represent all availability grids and subgroup overlaps as `u64` / `u128` bitmasks so the solver can evaluate $500{,}000+$ swap states per second per CPU thread.
* **Backend & Database:**
  * **PostgreSQL** with JSONB columns for flexible constraint payloads, plus relational tables for master entities and historical substitution logs.
  * **XML Import/Export Parser:** Support importing/exporting standard aSc XML files (`<timetable>` root schema) so schools migrating from aSc Timetables can bring their existing data in one click.
* **Frontend Interactive Grid:**
  * **React / Vue / SolidJS** coupled with HTML5 Canvas or virtualized CSS Grid for smooth $60\text{ FPS}$ drag-and-drop rendering across $100+$ classes and teachers.